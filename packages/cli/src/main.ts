/**
 * Assembled CLI program. Owns the process: resolves the data path, wires the
 * engine's platform layers, and runs the root command through
 * `@effected/cli`'s `CliRuntime.main` under `NodeRuntime.runMain`.
 *
 * `bin.ts` is the published bin shim (`#!/usr/bin/env node` +
 * `main()`); this module is also published as the `./main` subpath so the
 * carrier (`@vitest-agent/plugin`) can ship the same program behind its own
 * bin, threading its identity in through {@link MainOptions.distribution}.
 *
 * @packageDocumentation
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CliRuntime } from "@effected/cli";
import type { Distribution } from "@effected/engine";
import { CurrentDistribution } from "@effected/engine";
import {
	PathResolutionLive,
	PlatformLive,
	resolveDataPath,
	resolveLogFile,
	resolveLogLevel,
	resolveProjectDir,
} from "@vitest-agent/engine";
import { formatFatalError } from "@vitest-agent/sdk";
import { Effect, Layer, Option } from "effect";
import { Command } from "effect/unstable/cli";
import { agentCommand } from "./commands/agent.js";
import { dbCommand } from "./commands/db.js";
import { doctorCommand } from "./commands/doctor.js";
import { versionFormatterLayer } from "./lib/version-formatter.js";
import { CURRENT_CLI_VERSION } from "./version.js";

const rootCommand = Command.make("vitest-agent").pipe(
	Command.withSubcommands([dbCommand, doctorCommand, agentCommand]),
);

/**
 * Options the carrier's bin shim passes to {@link main}.
 *
 * @public
 */
export interface MainOptions {
	/**
	 * The meta-package the bin was launched through (for example
	 * `@vitest-agent/plugin`), appended to `--version` as
	 * ` via <name> <version>`. Omitted for a direct install of this package.
	 */
	readonly distribution?: Distribution | undefined;
}

/**
 * One rendering for every failure `CliRuntime.main` reports. A typed
 * (tagged) failure — a `PlatformError`, `SqlError`, `MigrationError` — is
 * one line; anything else is a defect and keeps the issue-report rendering
 * `formatFatalError` gives it. `ShowHelp` and runWith-rendered `UserError`s
 * never reach here (the kit skips them).
 */
const renderFailure = (error: unknown): string => {
	if (error instanceof Error && "_tag" in error && typeof error._tag === "string") {
		return `vitest-agent: ${error._tag}${error.message ? `: ${error.message}` : ""}`;
	}
	return `vitest-agent: ${formatFatalError(error)}`;
};

/**
 * Assembles and runs the CLI program, taking over the process. Not
 * re-exported from `index.ts` — a library consumer's import graph must not
 * pull in the process-owning module.
 *
 * Output routing (hooks parse `agent *` stdout with jq, so stdout carries
 * only what a command writes as its result):
 *
 * - Inside the platform, the engine's `LoggerLive` (installed by
 *   `PlatformLive`) is the active logger: silent unless
 *   `VITEST_REPORTER_LOG_LEVEL` is set, then NDJSON on stderr (plus
 *   `VITEST_REPORTER_LOG_FILE`). Every `Effect.log*` a command or engine
 *   service emits goes there.
 * - Outside the platform, `CliRuntime.main`'s default `CliLogger` is
 *   outermost and sends every level to stderr. It is what renders reported
 *   failures (a layer-build failure, a typed command failure, a defect)
 *   through `renderFailure`.
 * - Help goes to stdout and parse errors to stderr, both via the
 *   `CliOutput` formatter (`versionFormatterLayer`), as `Command.runWith`
 *   renders them.
 *
 * Exit codes are the kit's: `0` success (including bare `--help`), `64` a
 * usage error (parse error, unknown subcommand), `1` any other reported
 * failure. Commands that `process.exit` with their own code still do so.
 *
 * @public
 */
export const main = (options: MainOptions = {}): void => {
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

	const dataLayer = Layer.unwrap(
		Effect.map(resolveDataPath(projectDir), (dbPath) => PlatformLive({ dbPath, env, logLevel, logFile })),
	);

	// Provided through `CliRuntime.main`'s `platform`, i.e. INSIDE failure
	// reporting: a failure resolving the data path, opening SQLite, or running
	// migrations renders as a line on stderr and exits non-zero instead of
	// escaping to `runMain`'s default report.
	const platform = Layer.mergeAll(dataLayer, versionFormatterLayer).pipe(
		Layer.provideMerge(PathResolutionLive(projectDir)),
		Layer.provideMerge(NodeServices.layer),
	);

	const program = CliRuntime.main(Command.run(rootCommand, { version: CURRENT_CLI_VERSION }), {
		platform,
		render: renderFailure,
	}).pipe(
		// Outermost, so `versionFormatterLayer`'s build-time read of
		// `CurrentDistribution` sees the carrier's identity rather than the
		// reference's `Option.none()` default.
		Effect.provideService(CurrentDistribution, Option.fromNullishOr(options.distribution)),
	);

	NodeRuntime.runMain(program);
};
