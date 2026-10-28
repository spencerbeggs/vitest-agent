// CLI db command -- manage the vitest-agent database.

import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import { Cancelled, CliExit, CliInteractive, Fmt } from "@effected/cli";
import { ConfigLive, DataStore, VitestAgentConfigFile, resolveDataPath } from "@vitest-agent/engine";
import { RunRetentionPolicy, VitestAgentConfig } from "@vitest-agent/sdk";
import { Console, Effect, FileSystem, Layer, Option, Schema } from "effect";
import { Argument, Command, Flag, Prompt } from "effect/cli";
import { SqlClient } from "effect/sql/SqlClient";
import { ProjectDataLive, ProjectDir } from "../layers/project-data.js";
import { formatDbQuery } from "../lib/format-db-query.js";

const pathCommand = Command.make("path", {}, () =>
	Effect.gen(function* () {
		// The project directory comes from the `ProjectDir` service (main.ts's
		// `resolveProjectDir`), so `db path` reports the file hook-driven
		// recording writes to. No database is opened.
		const { dir } = yield* ProjectDir;
		const dbPath = yield* resolveDataPath(dir);
		yield* Effect.sync(() => process.stdout.write(`${dbPath}\n`));
	}),
).pipe(Command.withDescription("Print the resolved database path"));

// prune -----------------------------------------------------------------------

const keepRecentOption = Flag.withDefault(Flag.Int("keep-recent"), 30).pipe(
	Flag.withDescription("Number of most-recent sessions to keep in full"),
);

/** A whole number of runs or days, at least one — the same bound the `[retention]` table enforces. */
const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

const keepRunsOption = Flag.Int("keep-runs").pipe(
	Flag.withSchema(PositiveInt),
	Flag.optional,
	Flag.withDescription(
		`Newest runs to keep per project (overrides [retention] keepRuns; default ${RunRetentionPolicy.DEFAULT_KEEP_RUNS})`,
	),
);

const maxAgeDaysOption = Flag.Int("max-age-days").pipe(
	Flag.withSchema(PositiveInt),
	Flag.optional,
	Flag.withDescription("Also drop runs older than this many days (overrides [retention] maxAgeDays)"),
);

/**
 * The `vitest-agent.config.toml` loader over the resolved project directory,
 * for the run-retention policy `db prune` applies when no flag overrides it.
 */
const ProjectConfigLive = Layer.unwrap(
	Effect.gen(function* () {
		const { dir } = yield* ProjectDir;
		return ConfigLive(dir);
	}),
);

/**
 * The run-retention policy a manual prune applies: the config's policy
 * (default when the table is absent; none when `enabled = false`), with
 * either flag overriding its field. A flag re-enables a disabled policy —
 * the person asked for a prune by name.
 */
const resolveRunRetention = (
	configured: Option.Option<RunRetentionPolicy>,
	keepRuns: Option.Option<number>,
	maxAgeDays: Option.Option<number>,
): Option.Option<RunRetentionPolicy> => {
	if (Option.isNone(keepRuns) && Option.isNone(maxAgeDays)) return configured;
	const base = Option.getOrElse(configured, () =>
		RunRetentionPolicy.make({ keepRuns: RunRetentionPolicy.DEFAULT_KEEP_RUNS }),
	);
	const age = Option.isSome(maxAgeDays) ? maxAgeDays.value : base.maxAgeDays;
	return Option.some(
		RunRetentionPolicy.make({
			keepRuns: Option.getOrElse(keepRuns, () => base.keepRuns),
			...(age !== undefined && { maxAgeDays: age }),
		}),
	);
};

const pruneCommand = Command.make(
	"prune",
	{ keepRecent: keepRecentOption, keepRuns: keepRunsOption, maxAgeDays: maxAgeDaysOption },
	({ keepRecent, keepRuns, maxAgeDays }) =>
		Effect.gen(function* () {
			const store = yield* DataStore;
			const sql = yield* SqlClient;
			const configFile = yield* VitestAgentConfigFile;

			const sessions = yield* store.pruneSessions(keepRecent);
			yield* Effect.sync(() =>
				process.stdout.write(
					`Pruned ${sessions.prunedTurns} turn row(s) across ${sessions.affectedSessions} session(s); session rows retained.\n`,
				),
			);

			// Run retention (issue 623): the config's [retention] policy, or the
			// flags over it. Manual path only: checkpoint the WAL afterwards so
			// the freed pages reach the main file and the -wal shrinks now
			// rather than at the next connection's close.
			const config = yield* configFile.loadOrDefault(new VitestAgentConfig({}));
			const policy = resolveRunRetention(RunRetentionPolicy.fromConfig(config), keepRuns, maxAgeDays);
			if (Option.isNone(policy)) {
				yield* Effect.sync(() =>
					process.stdout.write("Run retention is disabled ([retention] enabled = false); no runs pruned.\n"),
				);
				return;
			}
			const runs = yield* store.pruneRuns(policy.value);
			yield* sql`PRAGMA wal_checkpoint(TRUNCATE)`;
			const age = policy.value.maxAgeDays === undefined ? "" : `, none older than ${policy.value.maxAgeDays} day(s)`;
			yield* Effect.sync(() =>
				process.stdout.write(
					`Pruned ${runs.prunedRuns} run(s) and ${runs.prunedFiles} orphaned file row(s); kept the newest ${policy.value.keepRuns} run(s) per project${age}.\n`,
				),
			);
		}),
).pipe(
	Command.withDescription(
		"Drop old sessions' turn history (keeps the last N in full) and apply the run-retention policy to test runs",
	),
	Command.provide(Layer.mergeAll(ProjectDataLive, ProjectConfigLive)),
);

// reset -----------------------------------------------------------------------

const yesOption = Flag.Boolean("yes").pipe(
	Flag.withDefault(false),
	Flag.withDescription("Skip the interactive confirmation prompt"),
);

const resetCommand = Command.make("reset", { yes: yesOption }, ({ yes }) =>
	Effect.gen(function* () {
		// Gate 1: agent context blocking
		const agentId = process.env.VITEST_AGENT_AGENT_ID;
		if (agentId !== undefined && agentId.length > 0) {
			yield* Console.error("db reset is human-only; use db prune or run from a human terminal");
			return yield* CliExit.set(4);
		}

		// Same project directory as every other command (see `db path`).
		const { dir } = yield* ProjectDir;
		const dbPath = yield* resolveDataPath(dir);

		// Gate 2: a run that may not prompt a person needs --yes. `CliInteractive`
		// is the kit's one decision: a human audience (no --agent / --ci /
		// VITEST_AGENT_AUDIENCE=agent|ci) with a terminal on stdin AND stdout.
		// An audience flag recomputes it from the TTY facts, so `--human` at a
		// real terminal in an agent-detected shell (Claude Code's) prompts.
		if (!yes && !(yield* CliInteractive)) {
			yield* Console.error(
				"db reset requires --yes when the run is not interactive (stdout or stdin is not a TTY, or the audience is not human)",
			);
			return yield* CliExit.set(5);
		}

		// Gate 3: interactive confirmation (only when interactive and no --yes).
		// Core's prompt over the kit's gated `Terminal`; Ctrl-C is `Cancelled`
		// (exit 130, "cancelled; nothing written").
		if (!yes) {
			const confirmed = yield* Prompt.run(Prompt.Confirm({ message: `Wipe ${dbPath}?`, initial: false })).pipe(
				Effect.catchTag("QuitError", () => Effect.fail(Cancelled.make({ reason: "interrupt" }))),
			);
			if (!confirmed) {
				yield* Console.log("aborted");
				return;
			}
		}

		// Perform deletion of data.db and its -shm / -wal companions
		const fs = yield* FileSystem.FileSystem;

		yield* fs.remove(dbPath).pipe(Effect.catch(() => Effect.void));
		yield* fs.remove(`${dbPath}-shm`).pipe(Effect.catch(() => Effect.void));
		yield* fs.remove(`${dbPath}-wal`).pipe(Effect.catch(() => Effect.void));

		yield* Console.log(`Deleted database at ${dbPath}`);
	}),
).pipe(Command.withDescription("Wipe the database (human-only; blocked in agent contexts)"));

// query -----------------------------------------------------------------------

const queryFormatOption = Flag.Literals("format", ["table", "json"]).pipe(
	Flag.withDefault("table"),
	Flag.withDescription("Output format for query results"),
);

const sqlArg = Argument.String("sql").pipe(
	Argument.withDescription("Read-only SQL statement to execute against data.db"),
);

const queryCommand = Command.make("query", { sql: sqlArg, format: queryFormatOption }, ({ sql, format }) =>
	Effect.gen(function* () {
		if (sql.trim().length === 0) {
			yield* Effect.sync(() => {
				process.stderr.write("db query: missing sql\n");
				process.exit(2);
			});
			return;
		}

		// Same project directory as every other command (see `db path`).
		const { dir } = yield* ProjectDir;
		const dbPath = yield* resolveDataPath(dir);

		// The connection is opened read-only; SQLite enforces the
		// invariant, so any mutation surfaces as a driver error rather
		// than needing parse-time SQL validation here.
		yield* Effect.gen(function* () {
			const client = yield* SqlClient;
			const rows = yield* client.unsafe<Record<string, unknown>>(sql);
			yield* Effect.sync(() => {
				process.stdout.write(`${formatDbQuery(rows, format)}\n`);
			});
		}).pipe(
			Effect.provide(sqliteClientLayer({ filename: dbPath, readonly: true })),
			Effect.catch((error) =>
				Effect.sync(() => {
					process.stderr.write(`db query: ${Fmt.errorText(error)}\n`);
					process.exit(3);
				}),
			),
		);
	}),
).pipe(Command.withDescription("Run a read-only SQL query against the database"));

// db parent -------------------------------------------------------------------

const dbParent = Command.make("db").pipe(Command.withDescription("Manage the vitest-agent database"));

export const dbCommand = dbParent.pipe(
	Command.withSubcommands([pathCommand, pruneCommand, resetCommand, queryCommand]),
);
