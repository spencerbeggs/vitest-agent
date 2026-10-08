/**
 * The main-process stray-output capture: a pass-through over Vitest's
 * `Logger.outputStream` / `errorStream` (the streams every pool worker's
 * stdio is piped into), driven here with a fake Logger over in-memory
 * Writables.
 */

import { PassThrough, Readable, Writable } from "node:stream";
import { readStrayOutput } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { installStrayOutputCapture, strayOutputCaptureOf } from "../src/utils/stray-output-capture.js";

class Sink extends Writable {
	readonly chunks: string[] = [];
	constructor(extra: Record<string, unknown> = {}) {
		super({ decodeStrings: false });
		Object.assign(this, extra);
	}
	override _write(chunk: unknown, _enc: BufferEncoding, cb: () => void): void {
		this.chunks.push(String(chunk));
		cb();
	}
	get text(): string {
		return this.chunks.join("");
	}
}

const fakeLogger = () => {
	const out = new Sink();
	const err = new Sink();
	return { logger: { outputStream: out as Writable, errorStream: err as Writable }, out, err };
};

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Pipe `chunks` into `dest` as a worker's stdio would be: Buffers, `end: false`. */
const pipeFrom = async (dest: Writable, ...chunks: string[]): Promise<void> => {
	const source = new PassThrough();
	source.pipe(dest, { end: false });
	for (const chunk of chunks) source.write(Buffer.from(chunk));
	source.end();
	await new Promise<void>((resolve) => source.on("end", resolve));
	await tick();
};

describe("installStrayOutputCapture", () => {
	it("passes worker bytes through unchanged and records them", async () => {
		const { logger, err } = fakeLogger();
		const capture = installStrayOutputCapture(logger, { stdout: new Sink(), stderr: new Sink() });
		await pipeFrom(logger.errorStream, "Preparing worktree ", "(new branch 'x')\n");
		expect(err.text).toBe("Preparing worktree (new branch 'x')\n");
		expect(capture.snapshot()).toMatchObject({
			total: 1,
			stderr: 1,
			samples: [{ stream: "stderr", text: "Preparing worktree (new branch 'x')" }],
		});
	});

	it("is installed once per Logger and published for other readers", async () => {
		const { logger, out } = fakeLogger();
		const terminal = { stdout: new Sink(), stderr: new Sink() };
		const first = installStrayOutputCapture(logger, terminal);
		const wrapped = logger.outputStream;
		expect(installStrayOutputCapture(logger, terminal)).toBe(first);
		expect(logger.outputStream).toBe(wrapped);
		expect(strayOutputCaptureOf(logger)).toBe(first);
		await pipeFrom(logger.outputStream, "hello\n");
		expect(out.text).toBe("hello\n");
		expect(readStrayOutput(logger)).toMatchObject({ total: 1, stdout: 1 });
	});

	it("lets Vitest's own escape-only writes through without recording them", async () => {
		const { logger, out } = fakeLogger();
		const capture = installStrayOutputCapture(logger, { stdout: out, stderr: new Sink() });
		capture.route(() => true);
		logger.outputStream.write("\u001b[?25h");
		await tick();
		expect(out.text).toBe("\u001b[?25h");
		expect(capture.snapshot()).toBeUndefined();
	});

	it("routes whole lines to the printer when the stream is the terminal, holding a partial line back", async () => {
		const { logger, err } = fakeLogger();
		const capture = installStrayOutputCapture(logger, { stdout: new Sink(), stderr: err });
		const printed: string[] = [];
		capture.route((stream, line) => {
			printed.push(`${stream}|${line}`);
			return true;
		});
		await pipeFrom(logger.errorStream, "Prep", "aring\nHEAD is ", "now");
		expect(printed).toEqual(["stderr|Preparing"]);
		expect(err.text).toBe("");
		await pipeFrom(logger.errorStream, " at abc\n");
		expect(printed).toEqual(["stderr|Preparing", "stderr|HEAD is now at abc"]);
		expect(err.text).toBe("");
		expect(capture.snapshot()?.stderr).toBe(2);
	});

	it("writes a line the printer declines to the original stream", async () => {
		const { logger, err } = fakeLogger();
		const capture = installStrayOutputCapture(logger, { stdout: new Sink(), stderr: err });
		capture.route(() => false);
		await pipeFrom(logger.errorStream, "declined\n");
		expect(err.text).toBe("declined\n");
	});

	it("flushes a held partial line to the original stream when routing stops", async () => {
		const { logger, err } = fakeLogger();
		const capture = installStrayOutputCapture(logger, { stdout: new Sink(), stderr: err });
		capture.route(() => true);
		await pipeFrom(logger.errorStream, "no newline");
		expect(err.text).toBe("");
		capture.route(undefined);
		expect(err.text).toBe("no newline");
		await pipeFrom(logger.errorStream, "after\n");
		expect(err.text).toBe("no newlineafter\n");
	});

	it("never routes a stream that is not the terminal (MCP's null sink stays the destination)", async () => {
		const { logger, out } = fakeLogger();
		const capture = installStrayOutputCapture(logger, { stdout: new Sink(), stderr: new Sink() });
		const printed: string[] = [];
		capture.route((_stream, line) => {
			printed.push(line);
			return true;
		});
		await pipeFrom(logger.outputStream, "to the sink\n");
		expect(printed).toEqual([]);
		expect(out.text).toBe("to the sink\n");
		expect(capture.snapshot()?.stdout).toBe(1);
	});

	it("reset starts a new run's recording", async () => {
		const { logger } = fakeLogger();
		const capture = installStrayOutputCapture(logger, { stdout: new Sink(), stderr: new Sink() });
		await pipeFrom(logger.errorStream, "old\n");
		capture.reset();
		expect(capture.snapshot()).toBeUndefined();
	});

	it("keeps the terminal facts the Logger reads (isTTY, columns) only where the original has them", () => {
		const tty = new Sink({ isTTY: true, columns: 132 });
		const logger = { outputStream: tty as Writable, errorStream: new Sink() as Writable };
		installStrayOutputCapture(logger, { stdout: tty, stderr: new Sink() });
		const out = logger.outputStream as Writable & { isTTY?: boolean; columns?: number };
		expect(out.isTTY).toBe(true);
		expect(out.columns).toBe(132);
		expect("columns" in logger.errorStream).toBe(false);
	});

	it("survives a Readable piped with backpressure-sized chunks", async () => {
		const { logger, err } = fakeLogger();
		const capture = installStrayOutputCapture(logger, { stdout: new Sink(), stderr: new Sink() });
		const big = `${"x".repeat(100_000)}\n`.repeat(20);
		const source = Readable.from([Buffer.from(big)]);
		source.pipe(logger.errorStream, { end: false });
		await new Promise<void>((resolve) => source.on("end", resolve));
		await tick();
		expect(err.text.length).toBe(big.length);
		expect(capture.snapshot()).toMatchObject({ total: 20, bytes: big.length });
	});
});
