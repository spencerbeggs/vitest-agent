/**
 * AgentReporter's side of the stray-output capture: it routes whole worker
 * lines to a reporter that can print above its live view, stops at Vitest's
 * close, resets per run, and puts the run's stray output on the rendered
 * reports and on `RunFinished`.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import type { ReporterRenderInput, RunEvent, VitestTestCase, VitestTestModule } from "@vitest-agent/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentReporter } from "../src/reporter.js";
import { installStrayOutputCapture } from "../src/utils/stray-output-capture.js";

class Sink extends Writable {
	readonly chunks: string[] = [];
	override _write(chunk: unknown, _enc: BufferEncoding, cb: () => void): void {
		this.chunks.push(String(chunk));
		cb();
	}
	get text(): string {
		return this.chunks.join("");
	}
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

const pipeFrom = async (dest: NodeJS.WritableStream, text: string): Promise<void> => {
	const source = new PassThrough();
	source.pipe(dest, { end: false });
	source.end(Buffer.from(text));
	await new Promise<void>((resolve) => source.on("end", resolve));
	await tick();
};

const module = (): VitestTestModule => {
	const test: VitestTestCase = {
		type: "test",
		name: "spawns git",
		fullName: "spawns git",
		tags: [],
		result: () => ({ state: "passed" }),
		diagnostic: () => ({ duration: 1, flaky: false, slow: false }),
	};
	return {
		type: "module",
		moduleId: "/abs/src/a.test.ts",
		relativeModuleId: "src/a.test.ts",
		project: { name: "" },
		state: () => "passed",
		children: {
			*allTests() {
				yield test;
			},
			*allSuites() {},
		},
		diagnostic: () => ({ duration: 1 }),
		errors: () => [],
	};
};

let cacheDir: string;
beforeEach(() => {
	cacheDir = mkdtempSync(join(tmpdir(), "vitest-agent-stray-"));
});
afterEach(() => {
	rmSync(cacheDir, { recursive: true, force: true });
});

/** A fake Vitest whose Logger streams are captured, with the terminal being those same streams. */
const fakeVitest = () => {
	const out = new Sink();
	const err = new Sink();
	const closers: Array<() => Promise<void>> = [];
	const logger = { outputStream: out as NodeJS.WritableStream, errorStream: err as NodeJS.WritableStream };
	const capture = installStrayOutputCapture(logger, { stdout: out, stderr: err });
	const vitest = { logger, onClose: (fn: () => Promise<void>) => closers.push(fn) };
	return { vitest, logger, out, err, capture, close: () => Promise.all(closers.map((fn) => fn())) };
};

describe("AgentReporter stray output", () => {
	it("routes whole lines to a reporter's printStrayLine, and stops at Vitest's close", async () => {
		const printed: string[] = [];
		const reporter = new AgentReporter({
			cacheDir,
			consoleMode: "silent",
			coverageMode: "ui-only",
			reporter: () => ({
				render: () => [],
				printStrayLine: (stream, line) => {
					printed.push(`${stream}|${line}`);
					return true;
				},
			}),
		});
		const fake = fakeVitest();
		await reporter.onInit(fake.vitest);
		await pipeFrom(fake.logger.errorStream, "Preparing worktree\npartial");
		expect(printed).toEqual(["stderr|Preparing worktree"]);
		expect(fake.err.text).toBe("");

		await fake.close();
		expect(fake.err.text).toBe("partial");
		await pipeFrom(fake.logger.errorStream, "after close\n");
		expect(printed).toEqual(["stderr|Preparing worktree"]);
		expect(fake.err.text).toBe("partialafter close\n");
	});

	it("prints a run's held partial line by that run's end, before RunFinished is published", async () => {
		const order: string[] = [];
		const reporter = new AgentReporter({
			cacheDir,
			consoleMode: "silent",
			coverageMode: "ui-only",
			reporter: () => ({
				render: () => [],
				printStrayLine: (stream, line) => {
					order.push(`${stream}|${line}`);
					return true;
				},
			}),
			onRunEvent: (e) => {
				if (e._tag === "RunFinished") order.push("RunFinished");
			},
		});
		const fake = fakeVitest();
		await reporter.onInit(fake.vitest);
		reporter.onTestRunStart([]);
		await pipeFrom(fake.logger.errorStream, "no trailing newline");
		await reporter.onTestRunEnd([module()], [], "passed");

		expect(order).toEqual(["stderr|no trailing newline", "RunFinished"]);
		expect(fake.err.text).toBe("");
	});

	it("leaves the streams as pass-through when no reporter prints stray lines", async () => {
		const reporter = new AgentReporter({
			cacheDir,
			consoleMode: "silent",
			coverageMode: "ui-only",
			reporter: () => ({ render: () => [] }),
		});
		const fake = fakeVitest();
		await reporter.onInit(fake.vitest);
		await pipeFrom(fake.logger.errorStream, "straight through\n");
		expect(fake.err.text).toBe("straight through\n");
	});

	it("puts the run's stray output on the rendered reports and on RunFinished, reset per run", async () => {
		const render = vi.fn((_input: ReporterRenderInput) => []);
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({
			cacheDir,
			consoleMode: "silent",
			coverageMode: "ui-only",
			reporter: () => ({ render }),
			onRunEvent: (e) => events.push(e),
		});
		const fake = fakeVitest();
		await reporter.onInit(fake.vitest);
		await pipeFrom(fake.logger.errorStream, "before the run\n");
		reporter.onTestRunStart([]);
		await pipeFrom(fake.logger.errorStream, "Preparing worktree (new branch 'x')\n");
		await reporter.onTestRunEnd([module()], [], "passed");

		const expected = {
			total: 1,
			stdout: 0,
			stderr: 1,
			samples: [{ stream: "stderr", text: "Preparing worktree (new branch 'x')" }],
		};
		expect(render).toHaveBeenCalledOnce();
		const reports = render.mock.calls[0]?.[0].reports ?? [];
		expect(reports.length).toBeGreaterThan(0);
		for (const report of reports) expect(report.strayOutput).toMatchObject(expected);
		expect(events.find((e) => e._tag === "RunFinished")).toMatchObject({ strayOutput: expected });
	});

	it("adds nothing when the run wrote nothing stray", async () => {
		const render = vi.fn((_input: ReporterRenderInput) => []);
		const reporter = new AgentReporter({
			cacheDir,
			consoleMode: "silent",
			coverageMode: "ui-only",
			reporter: () => ({ render }),
		});
		await reporter.onInit(fakeVitest().vitest);
		reporter.onTestRunStart([]);
		await reporter.onTestRunEnd([module()], [], "passed");
		for (const report of render.mock.calls[0]?.[0].reports ?? []) expect(report).not.toHaveProperty("strayOutput");
	});
});
