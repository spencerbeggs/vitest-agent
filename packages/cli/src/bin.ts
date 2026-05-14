#!/usr/bin/env node
/**
 * CLI entry point for vitest-agent.
 *
 * @packageDocumentation
 */

import { Command } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Cause, Console, Effect } from "effect";
import {
	CURRENT_SDK_VERSION,
	PathResolutionLive,
	formatFatalError,
	resolveDataPath,
	resolveLogFile,
	resolveLogLevel,
} from "vitest-agent-sdk";
import { cacheCommand } from "./commands/cache.js";
import { coverageCommand } from "./commands/coverage.js";
import { doctorCommand } from "./commands/doctor.js";
import { historyCommand } from "./commands/history.js";
import { internalCommand } from "./commands/internal.js";
import { overviewCommand } from "./commands/overview.js";
import { recordCommand } from "./commands/record.js";
import { showCommand } from "./commands/show.js";
import { statusCommand } from "./commands/status.js";
import { trendsCommand } from "./commands/trends.js";
import { triageCommand } from "./commands/triage.js";
import { wrapupCommand } from "./commands/wrapup.js";
import { CURRENT_CLI_VERSION } from "./index.js";
import { CliLive } from "./layers/CliLive.js";

const rootCommand = Command.make("vitest-agent").pipe(
	Command.withSubcommands([
		statusCommand,
		overviewCommand,
		coverageCommand,
		historyCommand,
		trendsCommand,
		cacheCommand,
		doctorCommand,
		recordCommand,
		showCommand,
		triageCommand,
		wrapupCommand,
		internalCommand,
	]),
);

const cli = Command.run(rootCommand, {
	name: "vitest-agent",
	version: "0.0.0",
});

const logLevel = resolveLogLevel();
const logFile = resolveLogFile();

// Cross-package version drift check. Compares this CLI's version against
// vitest-agent-sdk and writes a single stderr line on mismatch.
// Observation-only — never throws. See the root CLAUDE.md
// "Cross-package version drift" section.
if (CURRENT_SDK_VERSION !== CURRENT_CLI_VERSION) {
	process.stderr.write(
		`[vitest-agent-cli] version drift: vitest-agent-cli@${CURRENT_CLI_VERSION} ` +
			`with vitest-agent-sdk@${CURRENT_SDK_VERSION}. ` +
			`Reinstall vitest-agent-* packages so versions match.\n`,
	);
}

const projectDir = process.cwd();

const main = resolveDataPath(projectDir).pipe(
	Effect.flatMap((dbPath) =>
		Effect.suspend(() => cli(process.argv)).pipe(Effect.provide(CliLive(dbPath, logLevel, logFile))),
	),
	Effect.provide(PathResolutionLive(projectDir)),
	Effect.provide(NodeContext.layer),
	Effect.catchAllCause((cause) => {
		const defects = Cause.defects(cause);
		if (defects.length > 0) {
			return Console.error(`vitest-agent: ${formatFatalError(cause)}`).pipe(Effect.andThen(Effect.failCause(cause)));
		}
		return Effect.failCause(cause);
	}),
);

NodeRuntime.runMain(main as Effect.Effect<void>);
