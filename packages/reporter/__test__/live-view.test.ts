/**
 * The `stream` live view on the kit's production render path.
 *
 * `CliUiTest.live` runs `liveViewOptions` (the exact fold, drawing and run
 * predicates `startLiveView` hands `CliUi.live`) on an in-memory terminal,
 * with the view's tick on a `TestClock`. `startLiveView` itself is driven
 * over a real `PubSub` with a fixed, non-interactive environment to pin the
 * reporter-owned lifetime: subscribe first, end at the channel's shutdown,
 * close once.
 */

import { Writable } from "node:stream";
import { CliInteractive, CliTheme, Glyphs } from "@effected/cli";
import { UiStreams } from "@effected/cli/ui";
import { CliUiTest } from "@effected/cli/ui/testing";
import type { RunEvent } from "@vitest-agent/sdk";
import type { Scope } from "effect";
import { ConfigProvider, Effect, Layer, PubSub } from "effect";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect, it } from "vitest";
import { LiveViewEnv, liveViewOptions, startLiveView } from "../src/liveView.js";

const run = <A>(effect: Effect.Effect<A, never, Scope.Scope | TestClock.TestClock>): Promise<A> =>
	Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(TestClock.layer())));

const MODULE = "src/math.test.ts";

/** One run: one module, one test (`single-test` shape), ending at `RunFinished`. */
const runEvents = (runId: string, testName: string, status: "passed" | "failed"): ReadonlyArray<RunEvent> => [
	{ _tag: "RunStarted", runId, startedAt: "1970-01-01T00:00:00.000Z", configHash: "cfg" },
	{ _tag: "ModuleQueued", modulePath: MODULE },
	{ _tag: "ModuleStarted", modulePath: MODULE, startedAt: "1970-01-01T00:00:00.000Z" },
	{ _tag: "TestStarted", modulePath: MODULE, testName, suitePath: ["math"] },
	{
		_tag: "TestFinished",
		modulePath: MODULE,
		testName,
		suitePath: ["math"],
		status,
		durationMs: 4,
		...(status === "failed" ? { error: { message: "expected 1 to be 2" } } : {}),
	},
	{
		_tag: "ModuleFinished",
		modulePath: MODULE,
		passCount: status === "passed" ? 1 : 0,
		failCount: status === "failed" ? 1 : 0,
		skipCount: 0,
		durationMs: 6,
	},
	{
		_tag: "RunFinished",
		runId,
		finishedAt: "1970-01-01T00:00:00.080Z",
		passCount: status === "passed" ? 1 : 0,
		failCount: status === "failed" ? 1 : 0,
		skipCount: 0,
		durationMs: 80,
	},
];

/** What the plugin publishes after `RunFinished` (and `WatcherReady` in watch mode). */
const postRunEvents: ReadonlyArray<RunEvent> = [
	{
		_tag: "CoverageReady",
		metrics: { lines: 70, branches: 70, functions: 70, statements: 70 },
		thresholds: { lines: 80 },
		gaps: [],
	},
	{ _tag: "ThresholdViolation", metric: "lines", expected: 80, actual: 70 },
	{ _tag: "TrendComputed", direction: "stable", runCount: 3 },
	{ _tag: "WatcherReady" },
];

const occurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe("live view — CliUiTest.live over liveViewOptions", () => {
	it("commits the final frame once per run, and post-run events never draw a second copy", async () => {
		const out = await run(
			Effect.gen(function* () {
				const view = yield* CliUiTest.live({ ...liveViewOptions, columns: 80, rows: 30 });
				for (const event of runEvents("r1", "adds", "passed")) yield* view.publish(event);
				const framesAtFinish = (yield* view.frames).length;
				for (const event of postRunEvents) yield* view.publish(event);
				yield* view.advance("400 millis");
				const framesAfter = (yield* view.frames).length;
				yield* view.end;
				return { transcript: yield* view.transcript, framesAtFinish, framesAfter, written: yield* view.written };
			}),
		);
		expect(occurrences(out.transcript, "adds")).toBe(1);
		// Unmounted at RunFinished: neither the post-run events nor the tick draw.
		expect(out.framesAfter).toBe(out.framesAtFinish);
		// Never a scrollback wipe.
		expect(out.written).not.toContain("\u001b[3J");
	});

	it("remounts for the next run in watch mode, leaving the first run's frame above it", async () => {
		const transcript = await run(
			Effect.gen(function* () {
				const view = yield* CliUiTest.live({ ...liveViewOptions, columns: 80, rows: 30 });
				for (const event of runEvents("r1", "first run", "failed")) yield* view.publish(event);
				for (const event of postRunEvents) yield* view.publish(event);
				for (const event of runEvents("r2", "second run", "passed")) yield* view.publish(event);
				yield* view.end;
				return yield* view.transcript;
			}),
		);
		expect(occurrences(transcript, "first run")).toBe(1);
		expect(occurrences(transcript, "second run")).toBe(1);
		expect(transcript.indexOf("first run")).toBeLessThan(transcript.indexOf("second run"));
	});

	it("turns the spinner on the tick while a run is drawn", async () => {
		const out = await run(
			Effect.gen(function* () {
				const view = yield* CliUiTest.live({ ...liveViewOptions, columns: 80, rows: 30 });
				const events: ReadonlyArray<RunEvent> = [
					{ _tag: "RunStarted", runId: "r1", startedAt: "1970-01-01T00:00:00.000Z", configHash: "cfg" },
					{ _tag: "ModuleQueued", modulePath: "src/a.test.ts" },
					{ _tag: "ModuleQueued", modulePath: "src/b.test.ts" },
					{ _tag: "ModuleStarted", modulePath: "src/a.test.ts", startedAt: "1970-01-01T00:00:00.000Z" },
				];
				for (const event of events) yield* view.publish(event);
				const before = yield* view.plainFrame;
				yield* view.advance("80 millis");
				const after = yield* view.plainFrame;
				return { before, after };
			}),
		);
		expect(out.before).toContain(Glyphs.unicode.spinner[0]);
		expect(out.after).toContain(Glyphs.unicode.spinner[1]);
	});

	it("draws the ASCII glyph set when the terminal's theme selects it", async () => {
		const transcript = await run(
			Effect.gen(function* () {
				const view = yield* CliUiTest.live({ ...liveViewOptions, columns: 80, rows: 30, glyphs: "ascii" });
				for (const event of runEvents("r1", "adds", "failed")) yield* view.publish(event);
				yield* view.end;
				return yield* view.transcript;
			}),
		);
		expect(transcript).toContain("adds");
		expect(transcript).not.toMatch(/[✓✗↷⧖]/);
	});

	it("owned and not interactive: prints each run's final frame once, as a string", async () => {
		const out = await run(
			Effect.gen(function* () {
				const view = yield* CliUiTest.live({ ...liveViewOptions, columns: 80, rows: 30, interactive: false });
				for (const event of runEvents("r1", "adds", "failed")) yield* view.publish(event);
				for (const event of postRunEvents) yield* view.publish(event);
				yield* view.end;
				return { transcript: yield* view.transcript, frames: yield* view.frames };
			}),
		);
		expect(occurrences(out.transcript, "adds")).toBe(1);
		expect(out.frames).toEqual([]);
	});
});

describe("live view — LiveViewEnv", () => {
	it("selects the ASCII glyph set for TERM=dumb", async () => {
		const glyphs = await Effect.runPromise(
			Effect.gen(function* () {
				return (yield* CliTheme).glyphs;
			}).pipe(
				Effect.provide(LiveViewEnv),
				Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { TERM: "dumb" } }))),
			),
		);
		expect(glyphs).toEqual(Glyphs.ascii);
	});
});

/** A non-TTY capture stream for `UiStreams`. */
const capture = (): { stream: NodeJS.WriteStream; output: () => string } => {
	const chunks: string[] = [];
	const writable = new Writable({
		write(chunk, _encoding, callback) {
			chunks.push(chunk.toString());
			callback();
		},
	});
	Object.assign(writable, { isTTY: false, columns: 80, rows: 24 });
	return { stream: writable as unknown as NodeJS.WriteStream, output: () => chunks.join("") };
};

describe("live view — startLiveView lifetime", () => {
	it("sees events published before Ink loads, drains them all at close, and closes once", async () => {
		const out = capture();
		const env = Layer.mergeAll(
			CliTheme.layerTest(),
			Layer.succeed(CliInteractive, false),
			Layer.succeed(UiStreams, { stdin: process.stdin, stdout: out.stream, stderr: out.stream }),
		);
		const channel = Effect.runSync(PubSub.unbounded<RunEvent>());
		const view = startLiveView(channel, env);
		// Published synchronously, before the view's async Ink load: the
		// subscription was taken in startLiveView, so nothing is lost.
		for (const event of [...runEvents("r1", "adds", "failed"), ...postRunEvents]) {
			Effect.runSync(PubSub.publish(channel, event));
		}
		// The plugin's order at Vitest's close: the reporter closes first,
		// then the channel is shut down.
		await view.close();
		await view.close();
		Effect.runSync(PubSub.shutdown(channel));
		expect(occurrences(out.output(), "adds")).toBe(1);
		const state = await Effect.runPromise((await view.handle).state);
		expect(state.phase).toBe("finished");
		expect(state.coverage?.violations).toEqual([{ metric: "lines", expected: 80, actual: 70 }]);
	});
});
