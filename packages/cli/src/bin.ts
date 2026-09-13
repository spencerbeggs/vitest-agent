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
	PlatformLive,
	resolveDataPath,
	resolveLogFile,
	resolveLogLevel,
	resolveProjectDir,
} from "@vitest-agent/engine";
import { formatFatalError } from "@vitest-agent/sdk";
import { Cause, Console, Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { agentCommand } from "./commands/agent.js";
import { dbCommand } from "./commands/db.js";
import { doctorCommand } from "./commands/doctor.js";

const rootCommand = Command.make("vitest-agent").pipe(
	Command.withSubcommands([dbCommand, doctorCommand, agentCommand]),
);

const cli = Command.run(rootCommand, {
	version: "0.0.0",
});

const env = process.env;
const logLevel = resolveLogLevel(env);
const logFile = resolveLogFile(env);

// Resolve the project root used for `data.db` resolution. `resolveProjectDir`
// honors `VITEST_AGENT_PROJECT_DIR` (then the MCP server's
// `VITEST_AGENT_REPORTER_PROJECT_DIR`, then `CLAUDE_PROJECT_DIR`) before
// `process.cwd()` so hook-driven invocations resolve the SAME database the
// MCP server uses. Without this, a PostToolUse/SubagentStart hook that runs
// from a sub-package cwd (e.g. a monorepo workspace with its own
// package.json#name) resolves a different per-project `data.db`, so the
// open TDD task lives in one DB while artifact/turn recording writes to
// another — silently breaking evidence binding. The plugin's shared hook
// lib exports `VITEST_AGENT_PROJECT_DIR` from `CLAUDE_PROJECT_DIR`.
const projectDir = resolveProjectDir({ env, cwd: process.cwd() });

const main = resolveDataPath(projectDir).pipe(
	Effect.flatMap((dbPath) => cli.pipe(Effect.provide(PlatformLive({ dbPath, env, logLevel, logFile })))),
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
