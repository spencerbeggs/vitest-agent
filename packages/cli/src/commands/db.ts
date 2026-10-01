// CLI db command -- manage the vitest-agent database.

import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import { Cancelled, CliExit, CliInteractive } from "@effected/cli";
import { DataStore, resolveDataPath } from "@vitest-agent/engine";
import { Console, Effect, FileSystem } from "effect";
import { Argument, Command, Flag, Prompt } from "effect/cli";
import { SqlClient } from "effect/sql/SqlClient";
import { formatDbQuery } from "../lib/format-db-query.js";

const pathCommand = Command.make("path", {}, () =>
	Effect.gen(function* () {
		// Honor the VITEST_AGENT_PROJECT_DIR override before cwd so the `db`
		// commands resolve the SAME database as hook-driven recording (see
		// bin.ts) — otherwise `db path` would report a different file than the
		// one a sub-package-cwd hook actually writes to.
		const dbPath = yield* resolveDataPath(process.env.VITEST_AGENT_PROJECT_DIR ?? process.cwd());
		yield* Effect.sync(() => process.stdout.write(`${dbPath}\n`));
	}),
).pipe(Command.withDescription("Print the resolved database path"));

// prune -----------------------------------------------------------------------

const keepRecentOption = Flag.withDefault(Flag.Int("keep-recent"), 30).pipe(
	Flag.withDescription("Number of most-recent sessions to keep in full"),
);

const pruneCommand = Command.make("prune", { keepRecent: keepRecentOption }, ({ keepRecent }) =>
	Effect.gen(function* () {
		const store = yield* DataStore;
		const result = yield* store.pruneSessions(keepRecent);
		yield* Effect.sync(() =>
			process.stdout.write(
				`Pruned ${result.prunedTurns} turn row(s) across ${result.affectedSessions} session(s); session rows retained.\n`,
			),
		);
	}),
).pipe(Command.withDescription("Drop old sessions' turn history (W1 retention; keeps the last N in full)"));

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

		// Honor the VITEST_AGENT_PROJECT_DIR override before cwd so the `db`
		// commands resolve the SAME database as hook-driven recording (see
		// bin.ts) — otherwise `db path` would report a different file than the
		// one a sub-package-cwd hook actually writes to.
		const dbPath = yield* resolveDataPath(process.env.VITEST_AGENT_PROJECT_DIR ?? process.cwd());

		// Gate 2: a run that may not prompt a person needs --yes. `CliInteractive`
		// is the kit's one decision: a human audience (no --agent / --ci /
		// VITEST_AGENT_AUDIENCE=agent|ci) with a terminal on stdin AND stdout.
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

/**
 * Flatten an error and its cause chain into a single message so the
 * driver's `attempt to write a readonly database` text surfaces to
 * the user regardless of which layer wrapped it.
 */
const describeError = (error: unknown): string => {
	if (!(error instanceof Error)) return String(error);
	// Walk the full `.cause` chain, collecting each distinct message. v4's
	// `@effect/sql` wraps the driver error twice with the same top-level text
	// ("Failed to prepare/execute statement") before the real `node:sqlite`
	// message ("attempt to write a readonly database", "... syntax error")
	// appears deeper, so we must skip duplicate messages without halting the
	// walk. A `seen` set guards against a cyclic cause chain.
	const parts: string[] = [];
	const seen = new Set<Error>();
	let current: unknown = error;
	while (current instanceof Error && !seen.has(current)) {
		seen.add(current);
		if (current.message.length > 0 && !parts.includes(current.message)) {
			parts.push(current.message);
		}
		current = current.cause;
	}
	return parts.join(": ");
};

const queryCommand = Command.make("query", { sql: sqlArg, format: queryFormatOption }, ({ sql, format }) =>
	Effect.gen(function* () {
		if (sql.trim().length === 0) {
			yield* Effect.sync(() => {
				process.stderr.write("db query: missing sql\n");
				process.exit(2);
			});
			return;
		}

		// Honor the VITEST_AGENT_PROJECT_DIR override before cwd so the `db`
		// commands resolve the SAME database as hook-driven recording (see
		// bin.ts) — otherwise `db path` would report a different file than the
		// one a sub-package-cwd hook actually writes to.
		const dbPath = yield* resolveDataPath(process.env.VITEST_AGENT_PROJECT_DIR ?? process.cwd());

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
					process.stderr.write(`db query: ${describeError(error)}\n`);
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
