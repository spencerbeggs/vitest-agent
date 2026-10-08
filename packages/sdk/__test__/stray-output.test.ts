import type { StrayOutput } from "@vitest-agent/sdk";
import {
	AgentReport,
	STRAY_OUTPUT_SOURCE,
	StrayOutput as StrayOutputSchema,
	formatStrayOutputNote,
	isEscapeOnly,
	makeStrayOutputRecorder,
	readStrayOutput,
} from "@vitest-agent/sdk";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

describe("StrayOutput schema", () => {
	it("round-trips through encode/decode", () => {
		const value: StrayOutput = {
			total: 2,
			stdout: 0,
			stderr: 2,
			bytes: 64,
			samples: [{ stream: "stderr", text: "Preparing worktree (new branch 'x')" }],
		};
		const decoded = Schema.decodeUnknownSync(StrayOutputSchema)(Schema.encodeSync(StrayOutputSchema)(value));
		expect(decoded).toEqual(value);
	});

	it("is an optional AgentReport field", () => {
		const base = {
			timestamp: "2026-10-07T00:00:00.000Z",
			reason: "passed",
			summary: { total: 0, passed: 0, failed: 0, skipped: 0, duration: 0 },
			failed: [],
			unhandledErrors: [],
			failedFiles: [],
		};
		expect(Schema.decodeUnknownSync(AgentReport)(base).strayOutput).toBeUndefined();
		const stray = { total: 1, stdout: 1, stderr: 0, bytes: 3, samples: [{ stream: "stdout", text: "hi" }] };
		expect(Schema.decodeUnknownSync(AgentReport)({ ...base, strayOutput: stray }).strayOutput).toEqual(stray);
	});
});

describe("makeStrayOutputRecorder", () => {
	it("records nothing until something is written", () => {
		expect(makeStrayOutputRecorder().snapshot()).toBeUndefined();
	});

	it("counts lines per stream and the bytes written", () => {
		const recorder = makeStrayOutputRecorder();
		recorder.write("stderr", "one\ntwo\n");
		recorder.write("stdout", "three\n");
		expect(recorder.snapshot()).toEqual({
			total: 3,
			stdout: 1,
			stderr: 2,
			bytes: 14,
			samples: [
				{ stream: "stderr", text: "one" },
				{ stream: "stderr", text: "two" },
				{ stream: "stdout", text: "three" },
			],
		});
	});

	it("joins a line split across writes, and keeps the streams apart", () => {
		const recorder = makeStrayOutputRecorder();
		recorder.write("stderr", "Preparing ");
		recorder.write("stdout", "out\n");
		recorder.write("stderr", "worktree\n");
		const snapshot = recorder.snapshot();
		expect(snapshot?.stderr).toBe(1);
		expect(snapshot?.samples).toContainEqual({ stream: "stderr", text: "Preparing worktree" });
	});

	it("counts a trailing partial line in the snapshot", () => {
		const recorder = makeStrayOutputRecorder();
		recorder.write("stderr", "no newline");
		expect(recorder.snapshot()).toMatchObject({ total: 1, stderr: 1, samples: [{ text: "no newline" }] });
	});

	it("skips blank lines and strips escapes from samples", () => {
		const recorder = makeStrayOutputRecorder();
		recorder.write("stdout", "\n  \n\u001b[31mred\u001b[39m\r\n");
		expect(recorder.snapshot()).toMatchObject({ total: 1, samples: [{ stream: "stdout", text: "red" }] });
	});

	it("ignores escape-only writes (the Logger's cursor and clear-screen writes)", () => {
		const recorder = makeStrayOutputRecorder();
		recorder.write("stdout", "\u001b[?25h");
		recorder.write("stdout", "\u001bc\u001b[3J");
		expect(recorder.snapshot()).toBeUndefined();
	});

	it("caps the samples and their length, but keeps counting", () => {
		const recorder = makeStrayOutputRecorder({ maxSamples: 2, maxSampleChars: 5 });
		recorder.write("stderr", `${"x".repeat(50)}\nb\nc\nd\n`);
		const snapshot = recorder.snapshot();
		expect(snapshot?.total).toBe(4);
		expect(snapshot?.samples).toEqual([
			{ stream: "stderr", text: "xxxxx…" },
			{ stream: "stderr", text: "b" },
		]);
	});

	it("bounds a line that never ends", () => {
		const recorder = makeStrayOutputRecorder({ maxSampleChars: 8 });
		for (let i = 0; i < 1000; i++) recorder.write("stderr", "0123456789");
		expect(recorder.snapshot()).toMatchObject({ total: 1, bytes: 10_000, samples: [{ text: "01234567…" }] });
	});

	it("reset starts a new run", () => {
		const recorder = makeStrayOutputRecorder();
		recorder.write("stderr", "partial");
		recorder.reset();
		expect(recorder.snapshot()).toBeUndefined();
		recorder.write("stderr", "next\n");
		expect(recorder.snapshot()?.samples).toEqual([{ stream: "stderr", text: "next" }]);
	});
});

describe("isEscapeOnly", () => {
	it("is true for cursor, clear-screen and erase-scrollback escapes", () => {
		expect(isEscapeOnly("\u001b[?25l")).toBe(true);
		expect(isEscapeOnly("\u001bc\u001b[3J")).toBe(true);
	});

	it("is false for text, empty included", () => {
		expect(isEscapeOnly("")).toBe(false);
		expect(isEscapeOnly("\u001b[31mx")).toBe(false);
	});
});

describe("readStrayOutput", () => {
	it("reads the source a capture published on the logger", () => {
		const stray: StrayOutput = { total: 1, stdout: 1, stderr: 0, bytes: 2, samples: [] };
		expect(readStrayOutput({ [STRAY_OUTPUT_SOURCE]: { snapshot: () => stray } })).toBe(stray);
	});

	it("is undefined when nothing was published", () => {
		expect(readStrayOutput({})).toBeUndefined();
		expect(readStrayOutput(undefined)).toBeUndefined();
		expect(readStrayOutput({ [STRAY_OUTPUT_SOURCE]: "not a source" })).toBeUndefined();
	});
});

describe("formatStrayOutputNote", () => {
	it("names the count, the stream, the usual cause and the fix", () => {
		const lines = formatStrayOutputNote({
			total: 2,
			stdout: 0,
			stderr: 2,
			bytes: 60,
			samples: [
				{ stream: "stderr", text: "Preparing worktree (new branch 'x')" },
				{ stream: "stderr", text: "HEAD is now at abc123" },
			],
		});
		expect(lines).toEqual([
			'Stray output: tests wrote 2 lines directly to stderr, bypassing Vitest\'s console capture. A child process with inherited stdio is the usual cause; pass `stdio: "pipe"`.',
			"  stderr: Preparing worktree (new branch 'x')",
			"  stderr: HEAD is now at abc123",
		]);
	});

	it("says both streams, singular, and how many lines it left out", () => {
		const lines = formatStrayOutputNote({
			total: 5,
			stdout: 1,
			stderr: 4,
			bytes: 10,
			samples: [
				{ stream: "stdout", text: "a" },
				{ stream: "stderr", text: "b" },
				{ stream: "stderr", text: "c" },
				{ stream: "stderr", text: "d" },
			],
		});
		expect(lines[0]).toContain("wrote 5 lines directly to stdout and stderr");
		expect(lines.slice(1)).toEqual(["  stdout: a", "  stderr: b", "  stderr: c", "  (+2 more)"]);
		expect(
			formatStrayOutputNote({
				total: 1,
				stdout: 1,
				stderr: 0,
				bytes: 2,
				samples: [{ stream: "stdout", text: "x" }],
			})[0],
		).toContain("wrote 1 line directly to stdout,");
	});
});
