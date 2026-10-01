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
import type { FailureDetails } from "@effected/cli";
import { Cancelled, CliAudience, CliRuntime } from "@effected/cli";
import type { Distribution } from "@effected/engine";
import { CurrentDistribution } from "@effected/engine";
import { PathResolutionLive, PlatformLive, resolveDataPath, resolveProjectDir } from "@vitest-agent/engine";
import { formatFatalError } from "@vitest-agent/sdk";
import { Effect, Layer, Option } from "effect";
import { Command } from "effect/cli";
import { agentCommand } from "./commands/agent.js";
import { dbCommand } from "./commands/db.js";
import { doctorCommand } from "./commands/doctor.js";
import { withCarrierVersion } from "./lib/version-formatter.js";
import { CURRENT_CLI_VERSION } from "./version.js";

/**
 * The environment variable that overrides the detected audience
 * (`human` | `agent` | `ci`), read by `@effected/env`'s `Audience` through
 * `Config`. The `VITEST_AGENT_` prefix is the family's runtime-override
 * namespace (`VITEST_AGENT_CONSOLE`, `VITEST_AGENT_PROJECT_DIR`,
 * `VITEST_AGENT_CLI_CMD`); the `VITEST_REPORTER_` prefix survives only on the
 * two legacy logging variables.
 */
const AUDIENCE_ENV_VAR = "VITEST_AGENT_AUDIENCE";

const rootCommand = Command.make("vitest-agent").pipe(
	Command.withSharedFlags(CliAudience.flags()),
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
 * The one-line name of a typed failure: its `_tag` when it carries one (a
 * `PlatformError`, `SqlError`, `MigrationError`), else its `Error` name.
 */
const failureName = (error: unknown): string => {
	if (typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string") {
		return error._tag;
	}
	return error instanceof Error ? error.name : "Error";
};

/**
 * One rendering for every failure `CliRuntime.main` reports. The kit says
 * which kind it is (`details.isDefect`, exact: the cause carries no typed
 * failure): a typed failure from the error channel is one line, a defect
 * keeps the issue-report rendering `formatFatalError` gives it. `ShowHelp`
 * and runWith-rendered `UserError`s never reach here (the kit skips them).
 */
const renderFailure = (error: unknown, details: FailureDetails): string => {
	// A custom `render` replaces the kit's default rendering wholesale,
	// including its fixed `Cancelled` line, so keep that line here.
	if (error instanceof Cancelled) {
		return "vitest-agent: cancelled; nothing written";
	}
	if (details.isDefect) {
		return `vitest-agent: ${formatFatalError(error)}`;
	}
	const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
	return `vitest-agent: ${failureName(error)}${message ? `: ${message}` : ""}`;
};

/**
 * Assembles and runs the CLI program, taking over the process. Not
 * re-exported from `index.ts` — a library consumer's import graph must not
 * pull in the process-owning module.
 *
 * The one `@effected/cli` wiring: the root carries `CliAudience.flags()`
 * (`--audience <human|agent|ci>`, `--human`, `--agent`, `--ci`), runs through
 * `CliAudience.run`, and `CliRuntime.main`'s `env` option builds the
 * `@effected/env` services (`Audience` with the `VITEST_AGENT_AUDIENCE`
 * override, `TerminalEnv`, `CliTheme`, `CliInteractive`, the gated `Terminal`)
 * plus the kit's colour-decided help formatter, inside failure reporting.
 *
 * Output routing (hooks parse `agent *` stdout with jq, so stdout carries
 * only what a command writes as its result):
 *
 * - `env.log` makes `CliLog.layer` the one logger set, outermost: a
 *   `CliLogger` for ordinary lines and failure reports, plus a diagnostics
 *   sink that is silent unless `VITEST_REPORTER_LOG_LEVEL` is set (then
 *   NDJSON for agent / ci, pretty for a human TTY, stderr only), plus an
 *   async NDJSON file when `VITEST_REPORTER_LOG_FILE` is set. The platform
 *   therefore installs no logger of its own (`PlatformLive`'s `logger: false`:
 *   the engine's `LoggerLive` would otherwise replace this set inside the
 *   program).
 * - An explicit `--help` (or a bare group invocation) prints help on
 *   stdout. A usage error (unknown flag, bad value, unknown subcommand,
 *   conflicting audience flags) prints help AND the parse errors on stderr
 *   (`helpOnUsageError: "stderr"`), so stdout stays empty for a jq-piping
 *   hook.
 *
 * Exit codes are the kit's: `0` success (including bare `--help`), `64` a
 * usage error, `130` a cancelled prompt, `1` any other reported failure.
 * Commands that record their own code through `CliExit` (`db reset`) or
 * `process.exit` with it still exit with it.
 *
 * @public
 */
export const main = (options: MainOptions = {}): void => {
	const env = process.env;

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
		Effect.map(resolveDataPath(projectDir), (dbPath) => PlatformLive({ dbPath, env, logger: false })),
	);

	// Provided through `CliRuntime.main`'s `platform`, i.e. INSIDE failure
	// reporting: a failure resolving the data path, opening SQLite, or running
	// migrations renders as a line on stderr and exits non-zero instead of
	// escaping to `runMain`'s default report. It also supplies the `Stdio` and
	// `Terminal` the env layer reads, and the `FileSystem` / `Path` the log file
	// sink needs.
	const platform = dataLayer.pipe(
		Layer.provideMerge(PathResolutionLive(projectDir)),
		Layer.provideMerge(NodeServices.layer),
	);

	const program = CliRuntime.main(withCarrierVersion(CliAudience.run(rootCommand, { version: CURRENT_CLI_VERSION })), {
		platform,
		render: renderFailure,
		helpOnUsageError: "stderr",
		env: {
			audienceEnvVar: AUDIENCE_ENV_VAR,
			log: { envVar: "VITEST_REPORTER_LOG_LEVEL", file: { envVar: "VITEST_REPORTER_LOG_FILE" } },
		},
	}).pipe(
		// Outermost, so `withCarrierVersion` sees the carrier's identity rather
		// than the reference's `Option.none()` default.
		Effect.provideService(CurrentDistribution, Option.fromNullishOr(options.distribution)),
	);

	NodeRuntime.runMain(program);
};
