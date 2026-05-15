/**
 * CLI db command -- manage the vitest-agent database.
 *
 * @packageDocumentation
 */

import * as readline from "node:readline";
import { Args, Command, Options } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { SqlClient } from "@effect/sql/SqlClient";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import { Effect } from "effect";
import { DataStore, resolveDataPath } from "vitest-agent-sdk";
import { formatDbQuery } from "../lib/format-db-query.js";

const pathCommand = Command.make("path", {}, () =>
	Effect.gen(function* () {
		const dbPath = yield* resolveDataPath(process.cwd());
		yield* Effect.sync(() => process.stdout.write(`${dbPath}\n`));
	}),
).pipe(Command.withDescription("Print the resolved database path"));

// prune -----------------------------------------------------------------------

const keepRecentOption = Options.withDefault(Options.integer("keep-recent"), 30).pipe(
	Options.withDescription("Number of most-recent sessions to keep in full"),
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

const yesOption = Options.boolean("yes").pipe(
	Options.withDefault(false),
	Options.withDescription("Skip the interactive confirmation prompt"),
);

const resetCommand = Command.make("reset", { yes: yesOption }, ({ yes }) =>
	Effect.gen(function* () {
		// Gate 1: agent context blocking
		const agentId = process.env["VITEST_AGENT_AGENT_ID"];
		if (agentId !== undefined && agentId.length > 0) {
			yield* Effect.sync(() => {
				process.stderr.write("db reset is human-only; use db prune or run from a human terminal\n");
				process.exit(4);
			});
			return;
		}

		const dbPath = yield* resolveDataPath(process.cwd());

		// Gate 2: non-TTY without --yes
		if (!process.stdout.isTTY && !yes) {
			yield* Effect.sync(() => {
				process.stderr.write("db reset requires --yes when stdout is not a TTY\n");
				process.exit(5);
			});
			return;
		}

		// Gate 3: interactive TTY confirmation prompt (only when TTY and no --yes)
		if (process.stdout.isTTY && !yes) {
			const confirmed = yield* Effect.promise<boolean>(() => {
				return new Promise((resolve) => {
					const rl = readline.createInterface({
						input: process.stdin,
						output: process.stdout,
					});
					rl.question(`Wipe ${dbPath}? [y/N]: `, (answer) => {
						rl.close();
						resolve(answer === "y" || answer === "Y");
					});
				});
			});

			if (!confirmed) {
				yield* Effect.sync(() => {
					process.stdout.write("aborted\n");
					process.exit(0);
				});
				return;
			}
		}

		// Perform deletion of data.db and its -shm / -wal companions
		const fs = yield* FileSystem.FileSystem;

		yield* fs.remove(dbPath).pipe(Effect.catchAll(() => Effect.void));
		yield* fs.remove(`${dbPath}-shm`).pipe(Effect.catchAll(() => Effect.void));
		yield* fs.remove(`${dbPath}-wal`).pipe(Effect.catchAll(() => Effect.void));

		yield* Effect.sync(() => {
			process.stdout.write(`Deleted database at ${dbPath}\n`);
		});
	}).pipe(Effect.provide(NodeContext.layer)),
).pipe(Command.withDescription("Wipe the database (human-only; blocked in agent contexts)"));

// query -----------------------------------------------------------------------

const queryFormatOption = Options.choice("format", ["table", "json"]).pipe(
	Options.withDefault("table"),
	Options.withDescription("Output format for query results"),
);

const sqlArg = Args.text({ name: "sql" }).pipe(
	Args.withDescription("Read-only SQL statement to execute against data.db"),
);

/**
 * Flatten an error and its cause chain into a single message so the
 * driver's `attempt to write a readonly database` text surfaces to
 * the user regardless of which layer wrapped it.
 */
const describeError = (error: unknown): string => {
	if (!(error instanceof Error)) return String(error);
	const parts: string[] = [error.message];
	let cause: unknown = error.cause;
	while (cause instanceof Error && !parts.includes(cause.message)) {
		parts.push(cause.message);
		cause = cause.cause;
	}
	return parts.filter((part) => part.length > 0).join(": ");
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

		const dbPath = yield* resolveDataPath(process.cwd());

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
			Effect.catchAll((error) =>
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
