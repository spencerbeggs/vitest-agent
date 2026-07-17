import { appendFileSync } from "node:fs";
import { Layer, LogLevel, Logger, References } from "effect";

/**
 * Create a structured JSON (NDJSON) logger layer for stderr.
 *
 * When level is undefined or `"None"`, installs an empty logger set (silent).
 * When logFile is set, composes the stderr logger with a file logger.
 * Uses `Logger.formatJson` / `Logger.formatStructured` for machine-readable
 * output.
 * @public
 */
export const LoggerLive = (level?: LogLevel.LogLevel, logFile?: string): Layer.Layer<never> => {
	if (!level || level === "None") {
		return Logger.layer([]);
	}

	// Build a stderr NDJSON logger from formatJson (a Logger<unknown, string>).
	const stderrLogger = Logger.formatJson.pipe(Logger.withConsoleError);

	const fileLogger = logFile
		? Logger.formatStructured.pipe(
				Logger.map((entry) => {
					const line = JSON.stringify({
						timestamp: entry.timestamp,
						level: entry.level,
						message: entry.message,
						...entry.annotations,
					});
					try {
						appendFileSync(logFile, `${line}\n`);
					} catch {
						// Silently ignore file write failures in logging
					}
					return line;
				}),
			)
		: undefined;

	const loggers = fileLogger ? [stderrLogger, fileLogger] : [stderrLogger];

	return Layer.merge(Logger.layer(loggers), Layer.succeed(References.MinimumLogLevel, level));
};

/**
 * Resolve log level from option or environment variable.
 * Priority: explicit option \> VITEST_REPORTER_LOG_LEVEL env var \> undefined
 * @public
 */
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
/** @public */
export function resolveLogLevel(option?: string): LogLevel.LogLevel | undefined {
	const raw = option ?? process.env.VITEST_REPORTER_LOG_LEVEL;
	if (!raw) return undefined;
	// Resolve alias first ("warn" -> "Warn"), then try title-case normalization
	const normalized = LEVEL_ALIASES[raw.toLowerCase()] ?? `${raw.charAt(0).toUpperCase()}${raw.slice(1).toLowerCase()}`;
	return LogLevel.values.includes(normalized as LogLevel.LogLevel) ? (normalized as LogLevel.LogLevel) : undefined;
}

/**
 * Resolve log file from option or environment variable.
 * @public
 */
export function resolveLogFile(option?: string): string | undefined {
	return option ?? process.env.VITEST_REPORTER_LOG_FILE ?? undefined;
}
