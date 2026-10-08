/**
 * Stray output while the `stream` live view is drawn: a line a test process
 * wrote straight to the terminal is printed above the frame through the
 * kit's `handle.logConsole`, never under it where the next redraw strands it.
 */

import { Writable } from "node:stream";
import { CliInteractive, CliTheme } from "@effected/cli";
import { UiStreams } from "@effected/cli/ui";
import { CliUiTest } from "@effected/cli/ui/testing";
import type { RunEvent } from "@vitest-agent/sdk";
import type { Scope } from "effect";
import { Effect, Layer, PubSub } from "effect";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect, it } from "vitest";
import { DefaultVitestAgentReporter } from "../src/defaultReporter.js";
import { liveViewOptions, printAbove, startLiveView } from "../src/liveView.js";

const run = <A>(effect: Effect.Effect<A, never, Scope.Scope | TestClock.TestClock>): Promise<A> =>
	Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(TestClock.layer())));

const MODULE = "src/git.test.ts";
const STRAY = "Preparing worktree (new branch 'x')";

const head: ReadonlyArray<RunEvent> = [
	{ _tag: "RunStarted", runId: "r1", startedAt: "1970-01-01T00:00:00.000Z", configHash: "cfg" },
	{ _tag: "ModuleQueued", modulePath: MODULE },
	{ _tag: "ModuleStarted", modulePath: MODULE, startedAt: "1970-01-01T00:00:00.000Z" },
	{ _tag: "TestStarted", modulePath: MODULE, testName: "adds a worktree", suitePath: [] },
];
const tail: ReadonlyArray<RunEvent> = [
	{
		_tag: "TestFinished",
		modulePath: MODULE,
		testName: "adds a worktree",
		suitePath: [],
		status: "passed",
		durationMs: 4,
	},
	{ _tag: "ModuleFinished", modulePath: MODULE, passCount: 1, failCount: 0, skipCount: 0, durationMs: 6 },
	{
		_tag: "RunFinished",
		runId: "r1",
		finishedAt: "1970-01-01T00:00:00.080Z",
		passCount: 1,
		failCount: 0,
		skipCount: 0,
		durationMs: 80,
	},
];

const occurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe("live view — stray lines", () => {
	it("prints a stray line above the drawn frame, which stays whole below it", async () => {
		const transcript = await run(
			Effect.gen(function* () {
				const view = yield* CliUiTest.live({ ...liveViewOptions, columns: 80, rows: 30 });
				for (const event of head) yield* view.publish(event);
				expect(printAbove(view.handle)("stderr", STRAY)).toBe(true);
				yield* view.advance("80 millis");
				for (const event of tail) yield* view.publish(event);
				yield* view.end;
				return yield* view.transcript;
			}),
		);
		expect(occurrences(transcript, STRAY)).toBe(1);
		expect(occurrences(transcript, "adds a worktree")).toBe(1);
		expect(transcript.indexOf(STRAY)).toBeLessThan(transcript.indexOf("adds a worktree"));
	});
});

const capture = (): { stream: NodeJS.WriteStream; output: () => string } => {
	const chunks: string[] = [];
	const writable = new Writable({
		write(chunk, _encoding, callback) {
			chunks.push(chunk.toString());
			callback();
		},
	});
	return { stream: writable as unknown as NodeJS.WriteStream, output: () => chunks.join("") };
};

const pipedEnv = (out: { stream: NodeJS.WriteStream }) =>
	Layer.mergeAll(
		CliTheme.layerTest(),
		Layer.succeed(CliInteractive, false),
		Layer.succeed(UiStreams, { stdin: process.stdin, stdout: out.stream, stderr: out.stream }),
	);

describe("startLiveView — printStrayLine", () => {
	it("takes a line through the view once its handle is up, and declines after close", async () => {
		const out = capture();
		const channel = Effect.runSync(PubSub.unbounded<RunEvent>());
		const view = startLiveView(channel, pipedEnv(out));
		await view.handle;
		expect(view.printStrayLine("stderr", STRAY)).toBe(true);
		expect(out.output()).toContain(`${STRAY}\n`);
		await view.close();
		expect(view.printStrayLine("stderr", "late")).toBe(false);
		expect(out.output()).not.toContain("late");
	});
});

describe("DefaultVitestAgentReporter — printStrayLine", () => {
	const kit = (consoleMode: "stream" | "agent") =>
		({
			config: { consoleMode },
			stdEnv: "terminal",
			stdOsc8: (_url: string, label: string) => label,
			runEvents: Effect.runSync(PubSub.unbounded<RunEvent>()),
		}) as unknown as Parameters<typeof DefaultVitestAgentReporter>[0];

	it("is offered only by the stream mode's live view", async () => {
		const streaming = DefaultVitestAgentReporter(kit("stream"));
		const agent = DefaultVitestAgentReporter(kit("agent"));
		if (Array.isArray(streaming) || Array.isArray(agent)) throw new Error("expected one reporter");
		const single = streaming as Exclude<typeof streaming, ReadonlyArray<unknown>>;
		expect(typeof single.printStrayLine).toBe("function");
		expect((agent as typeof single).printStrayLine).toBeUndefined();
		await single.close?.();
	});
});
