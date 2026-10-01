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

import { isAbsolute, relative } from "node:path";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CliAudience, CliRuntime } from "@effected/cli";
import type { Distribution } from "@effected/engine";
import { CurrentDistribution } from "@effected/engine";
import { PathResolutionLive, PlatformLive, resolveDataPath, resolveProjectDir } from "@vitest-agent/engine";
import { Effect, Layer, Option } from "effect";
import { Command } from "effect/cli";
import { agentCommand } from "./commands/agent.js";
import { dbCommand } from "./commands/db.js";
import { doctorCommand } from "./commands/doctor.js";
import { renderFailure } from "./lib/render-failure.js";
import { carrierVersionFormatter } from "./lib/version-formatter.js";
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
 * `env.formatter` replaces only that formatter's `formatVersion`, so
 * `--version` names the carrier (`via @vitest-agent/plugin <version>`) when
 * `options.distribution` is given; the same value is provided as
 * `CurrentDistribution`. An audience flag recomputes `CliInteractive` from the
 * TTY facts, so `--human` in an agent-detected shell (Claude Code's terminal)
 * at a real terminal may prompt.
 *
 * Output routing (hooks parse `agent *` stdout with jq, so stdout carries
 * only what a command writes as its result):
 *
 * - `env.log` makes `CliLog.layer` the one logger set, outermost: a
 *   `CliLogger` for ordinary lines and failure reports, plus a diagnostics
 *   sink that is silent unless `VITEST_REPORTER_LOG_LEVEL` is set (then
 *   NDJSON on stderr for every audience), plus an
 *   async NDJSON file when `VITEST_REPORTER_LOG_FILE` is set. The platform
 *   therefore installs no logger of its own (`PlatformLive`'s `logger: false`:
 *   the engine's `LoggerLive` would otherwise replace this set inside the
 *   program). The platform is built under that logger, so what it logs
 *   while building (the engine's migration records) reaches the same sink.
 *   `format: "auto"`: NDJSON for an agent or a CI, plain lines for a person.
 *   `argv` (`process.argv.slice(2)`) lets the build-time records follow the
 *   audience flags too, so `--agent` with no agent detected is all NDJSON and
 *   `--human` in an agent shell is all plain, migration records included.
 * - Failures render through `renderFailure` on stderr, first line led by
 *   `vitest-agent: `. `env.displayPath` shows a defect's stack frames
 *   relative to the project directory (absolute when outside it).
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

	const distribution = Option.fromNullishOr(options.distribution);

	// Stack-frame paths in a defect report, relative to the project directory;
	// a path outside it (an installed bin, a global store) stays absolute.
	const displayPath = (absolute: string): string => {
		const rel = relative(projectDir, absolute);
		return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? absolute : rel;
	};

	const program = CliRuntime.main(CliAudience.run(rootCommand, { version: CURRENT_CLI_VERSION }), {
		platform,
		render: renderFailure,
		helpOnUsageError: "stderr",
		env: {
			audienceEnvVar: AUDIENCE_ENV_VAR,
			// `--version` names the carrier the bin was launched through.
			formatter: carrierVersionFormatter(distribution),
			displayPath,
			log: {
				envVar: "VITEST_REPORTER_LOG_LEVEL",
				format: "auto",
				// The build-time records honour --agent / --human only when handed argv.
				argv: process.argv.slice(2),
				file: { envVar: "VITEST_REPORTER_LOG_FILE" },
			},
		},
	}).pipe(Effect.provideService(CurrentDistribution, distribution));

	NodeRuntime.runMain(program);
};
