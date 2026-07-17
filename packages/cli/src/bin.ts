#!/usr/bin/env node

/**
 * CLI entry point for vitest-agent.
 *
 * @packageDocumentation
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
	PathResolutionLive,
	formatFatalError,
	resolveDataPath,
	resolveLogFile,
	resolveLogLevel,
} from "@vitest-agent/sdk";
import { Cause, Console, Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { agentCommand } from "./commands/agent.js";
import { dbCommand } from "./commands/db.js";
import { doctorCommand } from "./commands/doctor.js";
import { CliLive } from "./layers/CliLive.js";

const rootCommand = Command.make("vitest-agent").pipe(
	Command.withSubcommands([dbCommand, doctorCommand, agentCommand]),
);

const cli = Command.run(rootCommand, {
	version: "0.0.0",
});

const logLevel = resolveLogLevel();
const logFile = resolveLogFile();

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
	Effect.flatMap((dbPath) => cli.pipe(Effect.provide(CliLive(dbPath, logLevel, logFile)))),
	Effect.provide(PathResolutionLive(projectDir)),
	Effect.provide(NodeServices.layer),
	Effect.catchCause((cause) => {
		const defects = cause.reasons.filter(Cause.isDieReason);
		if (defects.length > 0) {
			return Console.error(`vitest-agent: ${formatFatalError(cause)}`).pipe(Effect.andThen(Effect.failCause(cause)));
		}
		return Effect.failCause(cause);
	}),
);

NodeRuntime.runMain(main as Effect.Effect<void>);
