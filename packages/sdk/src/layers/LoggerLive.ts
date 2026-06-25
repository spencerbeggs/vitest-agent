import { appendFileSync } from "node:fs";
import { Layer, LogLevel, Logger } from "effect";

/**
 * Create a structured JSON (NDJSON) logger layer for stderr.
 *
 * When level is undefined or LogLevel.None, replaces the default logger with Logger.none (silent).
 * When logFile is set, composes with a file logger via Logger.zip.
 * Uses Logger.structuredLogger serialized to JSON for machine-readable output.
 * @public
 */
export const LoggerLive = (level?: LogLevel.LogLevel, logFile?: string): Layer.Layer<never> => {
	if (!level || level._tag === "None") {
		return Logger.replace(Logger.defaultLogger, Logger.none);
	}

	// Build a stderr NDJSON logger from structuredLogger
	const stderrLogger = Logger.structuredLogger.pipe(
		Logger.map((entry) => JSON.stringify(entry)),
		Logger.withConsoleError,
	);

	const baseLogger = logFile
		? (() => {
				const fileLogger = Logger.make<unknown, void>(({ message, date, logLevel, annotations }) => {
					const entry = JSON.stringify({
						timestamp: date.toISOString(),
						level: logLevel._tag,
						message,
						...Object.fromEntries(annotations),
					});
					try {
						appendFileSync(logFile, `${entry}\n`);
					} catch {
						// Silently ignore file write failures in logging
					}
				});
				return Logger.zip(stderrLogger, fileLogger).pipe(Logger.map(() => undefined));
			})()
		: stderrLogger;

	return Layer.merge(Logger.replace(Logger.defaultLogger, baseLogger), Logger.minimumLogLevel(level));
};

/**
 * Resolve log level from option or environment variable.
 * Priority: explicit option \> VITEST_REPORTER_LOG_LEVEL env var \> undefined
 * @public
 */
// Map common shorthand names to Effect's LogLevel.Literal values
const LEVEL_ALIASES: Record<string, string> = {
	warn: "Warning",
	error: "Error",
	info: "Info",
	debug: "Debug",
	trace: "Trace",
	fatal: "Fatal",
	all: "All",
	none: "None",
	warning: "Warning",
};
/** @public */
export function resolveLogLevel(option?: string): LogLevel.LogLevel | undefined {
	const raw = option ?? process.env.VITEST_REPORTER_LOG_LEVEL;
	if (!raw) return undefined;
	// Resolve alias first ("warn" -> "Warning"), then try title-case normalization
	const normalized = LEVEL_ALIASES[raw.toLowerCase()] ?? `${raw.charAt(0).toUpperCase()}${raw.slice(1).toLowerCase()}`;
	return LogLevel.fromLiteral(normalized as LogLevel.Literal);
}

/**
 * Resolve log file from option or environment variable.
 * @public
 */
export function resolveLogFile(option?: string): string | undefined {
	return option ?? process.env.VITEST_REPORTER_LOG_FILE ?? undefined;
}
