import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { CliLog } from "@effected/cli";
import { Layer, LogLevel, Logger } from "effect";

/**
 * Create a structured JSON (NDJSON) logger layer for stderr, over
 * `@effected/cli`'s `CliLog` in its diagnostics-only mode
 * (`format: "json"`, `plainLogger: false`): the already-resolved level is
 * passed as `level`, and no plain `CliLogger` is installed beside the sink, so
 * each record prints once and nothing reads the audience or the terminal.
 *
 * When level is undefined or `"None"`, installs an empty logger set (silent).
 * When logFile is set, `CliLog`'s asynchronous file sink also appends each
 * NDJSON line (the same shape as the stderr line) to that file; the first
 * write error prints one stderr line and disables the file sink.
 *
 * @remarks
 * The file sink needs `FileSystem` and `Path`; they are provided here (Node)
 * so the public signature stays `Layer.Layer<never>` for every caller.
 *
 * @param level - the diagnostics level; see {@link resolveLogLevel}
 * @param logFile - a file to append NDJSON lines to; see {@link resolveLogFile}
 * @public
 */
export const LoggerLive = (level?: LogLevel.LogLevel, logFile?: string): Layer.Layer<never> => {
	if (!level || level === "None") {
		return Logger.layer([]);
	}
	if (logFile === undefined) {
		return CliLog.layer({ format: "json", plainLogger: false, level });
	}
	return CliLog.layer({ format: "json", plainLogger: false, level, file: { path: logFile } }).pipe(
		Layer.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)),
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
