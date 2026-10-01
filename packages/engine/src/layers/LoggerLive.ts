import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { CliLog } from "@effected/cli";
import { Audience, TerminalEnv } from "@effected/env";
import { ConfigProvider, Layer, LogLevel, Logger, References } from "effect";

/** The variable `CliLog` reads the diagnostics level from. */
const LOG_LEVEL_VAR = "VITEST_REPORTER_LOG_LEVEL";

/**
 * What `CliLog.layer` needs to build, with the level already resolved.
 *
 * - The level travels as a one-key `ConfigProvider`: `CliLog` only reads it
 *   through `Config`, and the caller has already applied the option \> env
 *   precedence in {@link resolveLogLevel}.
 * - `Audience` and `TerminalEnv` are fixed snapshots. The format is pinned to
 *   `json`, so `CliLog` never consults either, but its signature requires
 *   both; the live `TerminalEnv.layer` would need `Stdio` and `Terminal`, which
 *   an MCP server must not touch.
 * - `MinimumLogLevel` is `None` while `CliLog` builds, which floors the plain
 *   `CliLogger` it installs beside the sink out of existence. Without it every
 *   Info+ record would print twice on stderr (once plain, once NDJSON).
 */
const cliLogInputs = (level: LogLevel.LogLevel) =>
	Layer.mergeAll(
		ConfigProvider.layer(ConfigProvider.fromEnvRecord({ [LOG_LEVEL_VAR]: level })),
		Audience.layerTest("agent"),
		TerminalEnv.layerTest(),
		Layer.succeed(References.MinimumLogLevel, "None"),
	);

/**
 * Create a structured JSON (NDJSON) logger layer for stderr, over
 * `@effected/cli`'s `CliLog`.
 *
 * When level is undefined or `"None"`, installs an empty logger set (silent).
 * When logFile is set, `CliLog`'s asynchronous file sink also appends each
 * NDJSON line (the same shape as the stderr line) to that file; the first
 * write error prints one stderr line and disables the file sink.
 *
 * @param level - the diagnostics level; see {@link resolveLogLevel}
 * @param logFile - a file to append NDJSON lines to; see {@link resolveLogFile}
 * @public
 */
export const LoggerLive = (level?: LogLevel.LogLevel, logFile?: string): Layer.Layer<never> => {
	if (!level || level === "None") {
		return Logger.layer([]);
	}
	const inputs = cliLogInputs(level);
	if (logFile === undefined) {
		return CliLog.layer({ envVar: LOG_LEVEL_VAR, format: "json" }).pipe(Layer.provide(inputs));
	}
	return CliLog.layer({ envVar: LOG_LEVEL_VAR, format: "json", file: { path: logFile } }).pipe(
		Layer.provide(Layer.mergeAll(inputs, NodeFileSystem.layer, NodePath.layer)),
	);
};

// Map common shorthand names to Effect's LogLevel string values
const LEVEL_ALIASES: Record<string, LogLevel.LogLevel> = {
	warn: "Warn",
	warning: "Warn",
	error: "Error",
	info: "Info",
	debug: "Debug",
	trace: "Trace",
	fatal: "Fatal",
	all: "All",
	none: "None",
};
/**
 * Resolve log level from option or environment variable.
 * Priority: explicit option \> `VITEST_REPORTER_LOG_LEVEL` in `env` \> undefined.
 *
 * @param env - the environment map to consult (the front end passes `process.env`)
 * @param option - explicit override
 * @public
 */
export function resolveLogLevel(
	env: Record<string, string | undefined>,
	option?: string,
): LogLevel.LogLevel | undefined {
	const raw = option ?? env.VITEST_REPORTER_LOG_LEVEL;
	if (!raw) return undefined;
	// Resolve alias first ("warn" -> "Warn"), then try title-case normalization
	const normalized = LEVEL_ALIASES[raw.toLowerCase()] ?? `${raw.charAt(0).toUpperCase()}${raw.slice(1).toLowerCase()}`;
	return LogLevel.values.includes(normalized as LogLevel.LogLevel) ? (normalized as LogLevel.LogLevel) : undefined;
}

/**
 * Resolve log file from option or environment variable
 * (`VITEST_REPORTER_LOG_FILE` in `env`).
 *
 * @param env - the environment map to consult (the front end passes `process.env`)
 * @param option - explicit override
 * @public
 */
export function resolveLogFile(env: Record<string, string | undefined>, option?: string): string | undefined {
	return option ?? env.VITEST_REPORTER_LOG_FILE ?? undefined;
}
