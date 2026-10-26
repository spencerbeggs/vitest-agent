import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { CliLog } from "@effected/cli";
import { CurrentRuntimeEnv } from "@effected/env";
import type { LogLevel } from "effect";
import { Layer, Logger } from "effect";

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
 * When `env` is given, it is built into `CurrentRuntimeEnv` for the layer's
 * own build context, which `CliLog` captures: under GitHub Actions every
 * stderr record is neutralized (no workflow command at line start, `##[`
 * escaped), including records logged from a fiber that carries no
 * `CurrentRuntimeEnv` of its own. Without `env`, records are sanitised but
 * not neutralized unless the logging fiber provides one.
 *
 * @remarks
 * The file sink needs `FileSystem` and `Path`. `CliLog` leaves them in `R`
 * (for `file: undefined` too), but they are provided here (Node) so the
 * public signature stays `Layer.Layer<never>` for every caller.
 *
 * @param level - the diagnostics level; see {@link resolveLogLevel}
 * @param logFile - a file to append NDJSON lines to; see {@link resolveLogFile}
 * @param env - the environment map to detect the runtime from (the front end passes `process.env`)
 * @public
 */
export const LoggerLive = (
	level?: LogLevel.LogLevel,
	logFile?: string,
	env?: Readonly<Record<string, string | undefined>>,
): Layer.Layer<never> => {
	if (!level || level === "None") {
		return Logger.layer([]);
	}
	const sink = CliLog.layer({
		format: "json",
		plainLogger: false,
		level,
		file: logFile === undefined ? undefined : { path: logFile },
	}).pipe(Layer.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)));
	return env === undefined ? sink : sink.pipe(Layer.provide(CurrentRuntimeEnv.layerFrom(env)));
};

// The accepted spellings of a level, lower-cased. The same table as
// `@effected/cli`'s `CliLog` level parser, which is module-private in the
// installed kit (no public parser to delegate to); every `LogLevel` has its
// lower-cased name here, so a case-insensitive lookup is the whole parse.
const LEVEL_ALIASES: Record<string, LogLevel.LogLevel> = {
	all: "All",
	trace: "Trace",
	debug: "Debug",
	info: "Info",
	warn: "Warn",
	warning: "Warn",
	error: "Error",
	fatal: "Fatal",
	none: "None",
};
/**
 * Resolve log level from option or environment variable.
 * Priority: explicit option \> `VITEST_REPORTER_LOG_LEVEL` in `env` \> undefined.
 *
 * Case-insensitive; `warning` is accepted for `Warn`. An unset or empty value,
 * or one that names no level, resolves to `undefined` (no diagnostics) without
 * a warning.
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
	const key = raw.toLowerCase();
	return Object.hasOwn(LEVEL_ALIASES, key) ? LEVEL_ALIASES[key] : undefined;
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
