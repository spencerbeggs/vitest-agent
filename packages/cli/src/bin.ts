#!/usr/bin/env node
/**
 * CLI entry point for vitest-agent.
 *
 * @packageDocumentation
 */

import { Command } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import {
	CURRENT_SDK_VERSION,
	PathResolutionLive,
	formatFatalError,
	resolveDataPath,
	resolveLogFile,
	resolveLogLevel,
} from "@vitest-agent/sdk";
import { Cause, Console, Effect } from "effect";
import { agentCommand } from "./commands/agent.js";
import { dbCommand } from "./commands/db.js";
import { doctorCommand } from "./commands/doctor.js";
import { CURRENT_CLI_VERSION } from "./index.js";
import { CliLive } from "./layers/CliLive.js";

const rootCommand = Command.make("vitest-agent").pipe(
	Command.withSubcommands([dbCommand, doctorCommand, agentCommand]),
);

const cli = Command.run(rootCommand, {
	name: "vitest-agent",
	version: "0.0.0",
});

const logLevel = resolveLogLevel();
const logFile = resolveLogFile();

// Cross-package version drift check. Compares this CLI's version against
// @vitest-agent/sdk and writes a single stderr line on mismatch.
// Observation-only — never throws. The `"0.0.0"` fallback marks a dev
// build where rslib-builder did not substitute the literal; skip the
// check to avoid spurious warnings during local source-loaded runs.
// See the root CLAUDE.md "Cross-package version drift" section.
if (CURRENT_CLI_VERSION !== "0.0.0" && CURRENT_SDK_VERSION !== CURRENT_CLI_VERSION) {
	process.stderr.write(
		`[@vitest-agent/cli] version drift: @vitest-agent/cli@${CURRENT_CLI_VERSION} ` +
			`with @vitest-agent/sdk@${CURRENT_SDK_VERSION}. ` +
			`Reinstall @vitest-agent/* packages so versions match.\n`,
	);
}

// Resolve the project root used for `data.db` resolution. Honor an explicit
// `VITEST_AGENT_PROJECT_DIR` override before `process.cwd()` so hook-driven
// invocations resolve the SAME database the MCP server uses (rooted at
// `CLAUDE_PROJECT_DIR`). Without this, a PostToolUse/SubagentStart hook that
// runs from a sub-package cwd (e.g. a monorepo workspace with its own
// package.json#name) resolves a different per-project `data.db`, so the
// open TDD task lives in one DB while artifact/turn recording writes to
// another — silently breaking evidence binding. The plugin's shared hook
// lib exports `VITEST_AGENT_PROJECT_DIR` from `CLAUDE_PROJECT_DIR`.
const projectDir = process.env.VITEST_AGENT_PROJECT_DIR ?? process.cwd();

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
