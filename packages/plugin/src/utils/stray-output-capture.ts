/**
 * Stray-output capture: a pass-through over Vitest's `Logger.outputStream` /
 * `errorStream`.
 *
 * Why those two streams (vitest\@5.0.0, `src/node/pools/workers/`): the forks
 * and vmForks pools fork each worker with `stdio: "pipe"` and pipe its stdout
 * and stderr into `project.vitest.logger.outputStream` / `errorStream`,
 * captured when the worker is constructed, so every raw byte a worker writes
 * (a grandchild process that inherits the worker's fds included, such as an
 * `execFileSync("git", …)` with default stdio) arrives on them. The threads
 * and vmThreads pools pipe a worker thread's JS-level `process.stdout` /
 * `stderr` the same way, but a child process spawned from a thread inherits
 * the main process's real fds 1/2, so its bytes reach the terminal directly
 * and nothing here can see them. Workers are constructed lazily by the pool,
 * at run time, long after `configureVitest`, so installing there is early
 * enough. The `Logger`'s own `console` was built from the ORIGINAL streams in
 * its constructor, so Vitest's logging bypasses the wrapper; its few direct
 * `outputStream.write` calls are escape-only (cursor show, clear screen),
 * which pass straight through unrecorded.
 *
 * Every byte is recorded (bounded: counts, a few sample lines). While a
 * printer is routed (the reporter's live view is up) and the stream's
 * original destination is the process terminal, bytes are line-buffered and
 * each whole line goes to the printer, which prints it above the live frame;
 * otherwise bytes pass through to the original stream. The line buffering,
 * UTF-8 decoding across writes, the hold limit, escape-only pass-through and
 * the delegated terminal facts are `@effected/cli/ui`'s `CliUi.routeStream`;
 * what stays here is patching the Logger, publishing the capture, and the
 * rule that only a terminal original is ever routed. The original is
 * whatever stream object the Logger held: under MCP's `run_tests` that is the
 * server's null sink, so worker output still never reaches the JSON-RPC
 * stdout, and it is never routed.
 */

import type { Writable } from "node:stream";
import type { RoutedStream } from "@effected/cli/ui";
import { CliUi } from "@effected/cli/ui";
import type { StrayOutputRecorder, StrayOutputSource, StrayOutputStream } from "@vitest-agent/sdk";
import { STRAY_OUTPUT_SOURCE, makeStrayOutputRecorder } from "@vitest-agent/sdk";

/**
 * Prints one whole line of stray output somewhere it will not tear a live
 * drawing. Returns `true` when it took the line; `false` sends the line to
 * the original stream.
 *
 * @internal
 */
export type StrayLinePrinter = (stream: StrayOutputStream, line: string) => boolean;

/**
 * The part of Vitest's `Logger` the capture reads and replaces.
 *
 * @internal
 */
export interface StrayOutputLogger {
	outputStream: NodeJS.WritableStream | Writable;
	errorStream: NodeJS.WritableStream | Writable;
}

/**
 * The installed capture for one Vitest instance's Logger.
 *
 * @internal
 */
export interface StrayOutputCapture extends StrayOutputSource {
	/** Forget what was recorded: a new run starts. */
	readonly reset: () => void;
	/**
	 * Route whole lines to `printer` (for streams whose original is the
	 * terminal), or stop routing with `undefined`, which first writes any held
	 * partial line to its original stream.
	 */
	readonly route: (printer: StrayLinePrinter | undefined) => void;
	/**
	 * Hand each held partial line (text after the last newline) to the
	 * current printer, or to its original stream when there is none or it
	 * declines. Called at each run's end, so a child's unterminated last write
	 * shows in the run it belongs to instead of waiting for Vitest's close.
	 */
	readonly flush: () => void;
}

/**
 * The process's own terminal streams; only a stream whose original is one of
 * these is ever routed to a printer.
 *
 * @internal
 */
export interface StrayOutputTerminal {
	readonly stdout: unknown;
	readonly stderr: unknown;
}

const isCapture = (value: unknown): value is StrayOutputCapture =>
	typeof value === "object" && value !== null && "route" in value && "snapshot" in value;

/**
 * The capture installed on `logger`, if any.
 *
 * @internal
 */
export const strayOutputCaptureOf = (logger: unknown): StrayOutputCapture | undefined => {
	if (typeof logger !== "object" || logger === null) return undefined;
	const value = (logger as { [STRAY_OUTPUT_SOURCE]?: unknown })[STRAY_OUTPUT_SOURCE];
	return isCapture(value) ? value : undefined;
};

/**
 * Wrap `logger`'s output and error streams with the stray-output capture, once
 * per Logger (a second call returns the first capture). The capture is
 * published on the Logger under `STRAY_OUTPUT_SOURCE`, so MCP's `run_tests`
 * (which cannot import the plugin) reads the run's stray output with the
 * sdk's `readStrayOutput`.
 *
 * @param logger - the Vitest instance's `logger`
 * @param terminal - the process's own stdout and stderr
 *
 * @internal
 */
export const installStrayOutputCapture = (
	logger: StrayOutputLogger,
	terminal: StrayOutputTerminal,
): StrayOutputCapture => {
	const existing = strayOutputCaptureOf(logger);
	if (existing !== undefined) return existing;

	const recorder: StrayOutputRecorder = makeStrayOutputRecorder();
	let printer: StrayLinePrinter | undefined;
	const print: StrayLinePrinter = (stream, line) => printer?.(stream, line) ?? false;

	const wrap = (stream: StrayOutputStream, original: NodeJS.WritableStream): RoutedStream => {
		const routed = CliUi.routeStream(original, print, {
			stream,
			// The recorder skips escape-only text itself (the Logger's cursor and
			// clear-screen writes), so every decoded piece is handed to it.
			onText: (text) => recorder.write(stream, text),
		});
		// Routing starts off: it is on only while a printer is routed.
		routed.route(false);
		return routed;
	};
	const streams = {
		stdout: { original: logger.outputStream, routed: wrap("stdout", logger.outputStream) },
		stderr: { original: logger.errorStream, routed: wrap("stderr", logger.errorStream) },
	};
	logger.outputStream = streams.stdout.routed.writable;
	logger.errorStream = streams.stderr.routed.writable;

	const capture: StrayOutputCapture = {
		snapshot: recorder.snapshot,
		reset: recorder.reset,
		route: (next) => {
			printer = next;
			for (const name of ["stdout", "stderr"] as const) {
				const { original, routed } = streams[name];
				// Turning routing off writes any held partial line to the original.
				routed.route(next !== undefined && original === terminal[name]);
			}
		},
		flush: () => {
			streams.stdout.routed.flush();
			streams.stderr.routed.flush();
		},
	};
	Object.defineProperty(logger, STRAY_OUTPUT_SOURCE, { value: capture, configurable: true });
	return capture;
};
