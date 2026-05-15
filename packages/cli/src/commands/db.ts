/**
 * CLI db command -- manage the vitest-agent database.
 *
 * @packageDocumentation
 */

import { Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { DataStore, resolveDataPath } from "vitest-agent-sdk";

const pathCommand = Command.make("path", {}, () =>
	Effect.gen(function* () {
		const dbPath = yield* resolveDataPath(process.cwd());
		yield* Effect.sync(() => process.stdout.write(`${dbPath}\n`));
	}),
).pipe(Command.withDescription("Print the resolved database path"));

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

const dbParent = Command.make("db").pipe(Command.withDescription("Manage the vitest-agent database"));

export const dbCommand = dbParent.pipe(Command.withSubcommands([pathCommand, pruneCommand]));
