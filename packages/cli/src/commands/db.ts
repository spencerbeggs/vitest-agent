/**
 * CLI db command -- manage the vitest-agent database.
 *
 * @packageDocumentation
 */

import * as readline from "node:readline";
import { Command, Options } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { DataStore, resolveDataPath } from "vitest-agent-sdk";

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

// db parent -------------------------------------------------------------------

const dbParent = Command.make("db").pipe(Command.withDescription("Manage the vitest-agent database"));

export const dbCommand = dbParent.pipe(Command.withSubcommands([pathCommand, pruneCommand, resetCommand]));
