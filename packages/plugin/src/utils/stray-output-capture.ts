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
 * otherwise bytes pass through to the original stream unchanged. The
 * original is whatever stream object the Logger held: under MCP's
 * `run_tests` that is the server's null sink, so worker output still never
 * reaches the JSON-RPC stdout, and it is never routed.
 */

import { Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import type { StrayOutputRecorder, StrayOutputSource, StrayOutputStream } from "@vitest-agent/sdk";
import { STRAY_OUTPUT_SOURCE, isEscapeOnly, makeStrayOutputRecorder } from "@vitest-agent/sdk";

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
 * The most text a stream holds back waiting for a newline. Past it, the held
 * text is routed as a line of its own, so a child that never writes a newline
 * cannot grow the buffer without bound.
 *
 * @internal
 */
export const MAX_HELD_CHARS = 8192;

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

// The terminal facts Vitest's Logger reads off its output stream
// (`isTTY` for the cursor writes, `columns` for `getColumns`), delegated only
// where the original carries them so `'columns' in stream` stays honest.
const DELEGATED = ["isTTY", "columns", "rows", "getColorDepth", "hasColors", "getWindowSize"] as const;

class StrayStream extends Writable {
	constructor(
		readonly original: NodeJS.WritableStream | Writable,
		private readonly take: (chunk: unknown, encoding: BufferEncoding) => void,
	) {
		super({ decodeStrings: false });
		for (const key of DELEGATED) {
			if (!(key in original)) continue;
			Object.defineProperty(this, key, {
				configurable: true,
				enumerable: true,
				get: () => {
					const value = (original as unknown as Record<string, unknown>)[key];
					return typeof value === "function" ? value.bind(original) : value;
				},
			});
		}
	}

	override _write(chunk: unknown, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
		try {
			this.take(chunk, encoding);
			callback();
		} catch (err) {
			callback(err instanceof Error ? err : new Error(String(err)));
		}
	}
}

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
	const originals = { stdout: logger.outputStream, stderr: logger.errorStream };
	const decoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
	const held: Record<StrayOutputStream, string> = { stdout: "", stderr: "" };
	let printer: StrayLinePrinter | undefined;

	const flushHeld = (stream: StrayOutputStream): void => {
		const text = held[stream];
		if (text === "") return;
		held[stream] = "";
		originals[stream].write(text);
	};

	const take = (stream: StrayOutputStream) => (chunk: unknown, encoding: BufferEncoding) => {
		const original = originals[stream];
		// Vitest's own writes arrive as strings (pipes deliver Buffers): an
		// escape-only one is the Logger's cursor or clear-screen write.
		if (typeof chunk === "string" && isEscapeOnly(chunk)) {
			(original as Writable).write(chunk, encoding);
			return;
		}
		const text = typeof chunk === "string" ? chunk : decoders[stream].write(chunk as Buffer);
		recorder.write(stream, text);
		const route = printer !== undefined && original === terminal[stream] ? printer : undefined;
		if (route === undefined) {
			(original as Writable).write(chunk, encoding);
			return;
		}
		const lines = (held[stream] + text).split("\n");
		const rest = lines.pop() ?? "";
		if (rest.length > MAX_HELD_CHARS) {
			lines.push(rest);
			held[stream] = "";
		} else {
			held[stream] = rest;
		}
		for (const line of lines) {
			if (!route(stream, line)) original.write(`${line}\n`);
		}
	};

	const flushHeldThrough = (stream: StrayOutputStream): void => {
		const text = held[stream];
		if (text === "") return;
		held[stream] = "";
		if (printer === undefined || !printer(stream, text)) originals[stream].write(text);
	};

	logger.outputStream = new StrayStream(originals.stdout, take("stdout"));
	logger.errorStream = new StrayStream(originals.stderr, take("stderr"));

	const capture: StrayOutputCapture = {
		snapshot: recorder.snapshot,
		reset: recorder.reset,
		route: (next) => {
			if (next === undefined) {
				flushHeld("stdout");
				flushHeld("stderr");
			}
			printer = next;
		},
		flush: () => {
			flushHeldThrough("stdout");
			flushHeldThrough("stderr");
		},
	};
	Object.defineProperty(logger, STRAY_OUTPUT_SOURCE, { value: capture, configurable: true });
	return capture;
};
