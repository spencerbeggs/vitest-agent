import type { RunEvent } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { reduceRenderStateAll } from "../../src/reducer.js";
import { StreamApp } from "../../src/render-ink/StreamApp.js";
import { renderInk } from "../utils/render-ink.js";

const NOW = Date.parse("2026-05-19T00:00:10.000Z");
const STARTED = "2026-05-19T00:00:00.000Z";
const run = (events: ReadonlyArray<RunEvent>) => reduceRenderStateAll(events);

describe("StreamApp — workspace shape", () => {
	it("renders per-project completion rows, Coverage, Trend, and Total in the final frame", () => {
		// All content lands in the Live region (no Static). The final frame
		// carries the full picture including completed rows and summary lines.
		const state = run([
			{ _tag: "RunStarted", runId: "r", startedAt: STARTED, configHash: "h" },
			{ _tag: "ModuleStarted", modulePath: "sdk/a.test.ts", startedAt: STARTED, projectName: "sdk" },
			{
				_tag: "ModuleFinished",
				modulePath: "sdk/a.test.ts",
				passCount: 961,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 6200,
				projectName: "sdk",
			},
			{ _tag: "ModuleStarted", modulePath: "ui/b.test.ts", startedAt: STARTED, projectName: "ui" },
			{
				_tag: "ModuleFinished",
				modulePath: "ui/b.test.ts",
				passCount: 212,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 104100,
				projectName: "ui",
			},
			{
				_tag: "CoverageReady",
				metrics: { lines: 90, branches: 90, functions: 90, statements: 90 },
				thresholds: {},
				gaps: [],
			},
			{ _tag: "TrendComputed", direction: "stable", runCount: 5 },
			{
				_tag: "RunFinished",
				runId: "r",
				finishedAt: STARTED,
				passCount: 1173,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 110300,
			},
		]);
		const { frame, cleanup } = renderInk(<StreamApp state={state} frameIndex={0} nowMs={NOW} />, 80);
		expect(frame).toContain("961✓");
		expect(frame).toContain("Coverage:");
		expect(frame).toContain("Trend: stable (5 runs)");
		expect(frame).toContain("Total:");
		// The old `RunSummary` "Tests:" line is gone.
		expect(frame).not.toContain("Tests:");
		cleanup();
	});

	it("renders failure rows in the frame when the run has failures", () => {
		const state = run([
			{ _tag: "RunStarted", runId: "r", startedAt: STARTED, configHash: "h" },
			{ _tag: "ModuleStarted", modulePath: "cli/a.test.ts", startedAt: STARTED, projectName: "cli" },
			{
				_tag: "TestFinished",
				modulePath: "cli/a.test.ts",
				testName: "rewrites the command",
				suitePath: ["injectEnv"],
				status: "failed",
				durationMs: 3,
				error: { message: "AssertionError: expected x to be y" },
			},
			{
				_tag: "ModuleFinished",
				modulePath: "cli/a.test.ts",
				passCount: 54,
				failCount: 1,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 37300,
				projectName: "cli",
			},
			{ _tag: "ModuleStarted", modulePath: "sdk/b.test.ts", startedAt: STARTED, projectName: "sdk" },
			{
				_tag: "ModuleFinished",
				modulePath: "sdk/b.test.ts",
				passCount: 961,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 6200,
				projectName: "sdk",
			},
			{
				_tag: "RunFinished",
				runId: "r",
				finishedAt: STARTED,
				passCount: 1015,
				failCount: 1,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 43500,
			},
		]);
		const { frame, cleanup } = renderInk(<StreamApp state={state} frameIndex={0} nowMs={NOW} />, 80);
		expect(frame).toContain("rewrites the command");
		expect(frame).toContain("AssertionError: expected x to be y");
		cleanup();
	});
});

describe("StreamApp — single-file shape", () => {
	it("lists test rows in the frame and expands a failing test's error inline", () => {
		const state = run([
			{ _tag: "RunStarted", runId: "r", startedAt: STARTED, configHash: "h" },
			{ _tag: "ModuleStarted", modulePath: "reducer.test.ts", startedAt: STARTED },
			{
				_tag: "TestFinished",
				modulePath: "reducer.test.ts",
				testName: "one",
				suitePath: [],
				status: "passed",
				durationMs: 2,
			},
			{
				_tag: "TestFinished",
				modulePath: "reducer.test.ts",
				testName: "two",
				suitePath: [],
				status: "failed",
				durationMs: 6,
				error: { message: "AssertionError: expected 3 to be 4" },
			},
			{
				_tag: "ModuleFinished",
				modulePath: "reducer.test.ts",
				passCount: 1,
				failCount: 1,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 8,
			},
			{
				_tag: "RunFinished",
				runId: "r",
				finishedAt: STARTED,
				passCount: 1,
				failCount: 1,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 8,
			},
		]);
		const { frame, cleanup } = renderInk(<StreamApp state={state} frameIndex={0} nowMs={NOW} />, 80);
		expect(frame).toContain("one");
		expect(frame).toContain("two");
		expect(frame).toContain("AssertionError: expected 3 to be 4");
		expect(frame).toContain("Total:");
		// Leaf shapes expand the failure inline under its row only — there is
		// no aggregate Failures section for single-file, so the error message
		// must appear exactly once (not duplicated by a Failures block).
		expect(frame.split("AssertionError: expected 3 to be 4").length - 1).toBe(1);
		cleanup();
	});
});

describe("StreamApp — single-test shape", () => {
	it("renders only the single leaf line in Live — no Total, no Static", () => {
		// `single-test` is Live-only by spec §11.7 — assert against `frame`
		// (the last live frame), not `fullOutput`.
		const state = run([
			{ _tag: "RunStarted", runId: "r", startedAt: STARTED, configHash: "h" },
			{ _tag: "ModuleStarted", modulePath: "a.test.ts", startedAt: STARTED },
			{
				_tag: "TestFinished",
				modulePath: "a.test.ts",
				testName: "adds",
				suitePath: [],
				status: "passed",
				durationMs: 4,
			},
			{
				_tag: "ModuleFinished",
				modulePath: "a.test.ts",
				passCount: 1,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 4,
			},
			{
				_tag: "RunFinished",
				runId: "r",
				finishedAt: STARTED,
				passCount: 1,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 4,
			},
		]);
		const { frame, cleanup } = renderInk(<StreamApp state={state} frameIndex={0} nowMs={NOW} />, 80);
		expect(frame).toContain("adds");
		expect(frame).not.toContain("Total:");
		cleanup();
	});
});

describe("StreamApp — timed-out run", () => {
	it("renders the timeout banner and resolves a running row to the timeout glyph", () => {
		const state = run([
			{ _tag: "RunStarted", runId: "r", startedAt: STARTED, configHash: "h" },
			{ _tag: "ModuleStarted", modulePath: "cli/a.test.ts", startedAt: STARTED, projectName: "cli" },
			{ _tag: "ModuleStarted", modulePath: "ui/b.test.ts", startedAt: STARTED, projectName: "ui" },
			{ _tag: "RunTimedOut", message: "process timeout" },
		]);
		const { frame, cleanup } = renderInk(<StreamApp state={state} frameIndex={0} nowMs={NOW} />, 80);
		expect(frame).toContain("timed out");
		expect(frame).toContain("⧖");
		// No spinner Braille frame is still spinning on a row — running rows
		// must resolve to ⧖ when the run is timed out.
		expect(frame).not.toContain("⠋");
		cleanup();
	});
});

describe("StreamApp — workspace shape (skip-only)", () => {
	it("renders ↷ on a project whose modules contain only skipped tests", () => {
		const state = run([
			{ _tag: "RunStarted", runId: "r", startedAt: STARTED, configHash: "h" },
			{ _tag: "ModuleStarted", modulePath: "skip/a.test.ts", startedAt: STARTED, projectName: "skip" },
			{
				_tag: "ModuleFinished",
				modulePath: "skip/a.test.ts",
				passCount: 0,
				failCount: 0,
				skipCount: 4,
				timeoutCount: 0,
				durationMs: 10,
				projectName: "skip",
			},
			{ _tag: "ModuleStarted", modulePath: "ok/b.test.ts", startedAt: STARTED, projectName: "ok" },
			{
				_tag: "ModuleFinished",
				modulePath: "ok/b.test.ts",
				passCount: 3,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 10,
				projectName: "ok",
			},
			{
				_tag: "RunFinished",
				runId: "r",
				finishedAt: STARTED,
				passCount: 3,
				failCount: 0,
				skipCount: 4,
				timeoutCount: 0,
				durationMs: 20,
			},
		]);
		const { frame, cleanup } = renderInk(<StreamApp state={state} frameIndex={0} nowMs={NOW} />, 80);
		// The skip-only project row must carry the ↷ glyph. The ok project
		// still carries ✓. We assert the skip glyph appears next to "skip"
		// rather than just that ↷ exists somewhere — the count column also
		// contains a ↷ for the skip column.
		expect(frame).toMatch(/↷\s+skip\b/);
		cleanup();
	});
});

describe("StreamApp — finished project rendered exactly once", () => {
	it("renders a finished project exactly once in the frame", () => {
		// A workspace-shape state with one finished project and one
		// still-running project. The finished one belongs in the Live region
		// with its resolved glyph; the running one shows the spinner. The
		// rendered frame must carry `✓ done` exactly once — not duplicated.
		const state = run([
			{ _tag: "RunStarted", runId: "r", startedAt: STARTED, configHash: "h" },
			{ _tag: "ModuleStarted", modulePath: "done/a.test.ts", startedAt: STARTED, projectName: "done" },
			{
				_tag: "ModuleFinished",
				modulePath: "done/a.test.ts",
				passCount: 5,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 10,
				projectName: "done",
			},
			{ _tag: "ModuleStarted", modulePath: "live/b.test.ts", startedAt: STARTED, projectName: "live" },
		]);
		const { frame, cleanup } = renderInk(<StreamApp state={state} frameIndex={0} nowMs={NOW} />, 80);
		const occurrences = frame.split("✓ done").length - 1;
		expect(occurrences).toBe(1);
		cleanup();
	});
});

describe("StreamApp — tag-count suffix", () => {
	it("renders a merged tag suffix on a workspace project row", () => {
		const state = run([
			{ _tag: "RunStarted", runId: "r", startedAt: STARTED, configHash: "h" },
			{ _tag: "ModuleStarted", modulePath: "sdk/a.test.ts", startedAt: STARTED, projectName: "sdk" },
			{
				_tag: "ModuleFinished",
				modulePath: "sdk/a.test.ts",
				passCount: 961,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 6200,
				projectName: "sdk",
				tagCounts: { int: 6, unit: 955 },
			},
			{ _tag: "ModuleStarted", modulePath: "ui/b.test.ts", startedAt: STARTED, projectName: "ui" },
			{
				_tag: "ModuleFinished",
				modulePath: "ui/b.test.ts",
				passCount: 212,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 104100,
				projectName: "ui",
			},
			{
				_tag: "RunFinished",
				runId: "r",
				finishedAt: STARTED,
				passCount: 1173,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 110300,
			},
		]);
		const { frame, cleanup } = renderInk(<StreamApp state={state} frameIndex={0} nowMs={NOW} />, 120);
		expect(frame).toContain("int:   6  unit: 955");
		cleanup();
	});
});

describe("StreamApp — single-file inline error: expected/received", () => {
	it("renders expected: and received: lines beneath the message for a failing test", () => {
		const state = run([
			{ _tag: "RunStarted", runId: "r", startedAt: STARTED, configHash: "h" },
			{ _tag: "ModuleStarted", modulePath: "math.test.ts", startedAt: STARTED },
			{
				_tag: "TestFinished",
				modulePath: "math.test.ts",
				testName: "adds numbers",
				suitePath: [],
				status: "failed",
				durationMs: 2,
				error: {
					message: "AssertionError: expected 3 to be 4",
					expected: "4",
					received: "3",
				},
			},
			{
				_tag: "ModuleFinished",
				modulePath: "math.test.ts",
				passCount: 0,
				failCount: 1,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 2,
			},
			{
				_tag: "RunFinished",
				runId: "r",
				finishedAt: STARTED,
				passCount: 0,
				failCount: 1,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 2,
			},
		]);
		const { frame, cleanup } = renderInk(<StreamApp state={state} frameIndex={0} nowMs={NOW} />, 80);
		expect(frame).toContain("AssertionError: expected 3 to be 4");
		expect(frame).toContain("expected: 4");
		expect(frame).toContain("received: 3");
		cleanup();
	});

	it("does not render expected/received lines when the error has no structured values", () => {
		const state = run([
			{ _tag: "RunStarted", runId: "r", startedAt: STARTED, configHash: "h" },
			{ _tag: "ModuleStarted", modulePath: "math.test.ts", startedAt: STARTED },
			{
				_tag: "TestFinished",
				modulePath: "math.test.ts",
				testName: "throws",
				suitePath: [],
				status: "failed",
				durationMs: 1,
				error: { message: "Error: something went wrong" },
			},
			{
				_tag: "ModuleFinished",
				modulePath: "math.test.ts",
				passCount: 0,
				failCount: 1,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 1,
			},
			{
				_tag: "RunFinished",
				runId: "r",
				finishedAt: STARTED,
				passCount: 0,
				failCount: 1,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 1,
			},
		]);
		const { frame, cleanup } = renderInk(<StreamApp state={state} frameIndex={0} nowMs={NOW} />, 80);
		expect(frame).toContain("Error: something went wrong");
		expect(frame).not.toContain("expected:");
		expect(frame).not.toContain("received:");
		cleanup();
	});
});

describe("StreamApp — workspace shape Live region cap", () => {
	it("caps the Live region's running rows and adds an overflow line when more projects run concurrently than fit", () => {
		const events: RunEvent[] = [
			{ _tag: "RunStarted", runId: "r1", startedAt: "2026-05-20T00:00:00.000Z", configHash: "h" },
		];
		for (let i = 0; i < 8; i++) {
			const name = `p${i}`;
			const path = `${name}/a.test.ts`;
			events.push({ _tag: "ModuleQueued", modulePath: path, projectName: name });
			events.push({
				_tag: "ModuleStarted",
				modulePath: path,
				startedAt: "2026-05-20T00:00:00.000Z",
				projectName: name,
			});
		}
		const state = reduceRenderStateAll(events);
		const { frame, cleanup } = renderInk(<StreamApp state={state} frameIndex={0} nowMs={Date.now()} />);
		// Only the first 4 projects appear by name in the Live region.
		expect(frame).toContain("p0");
		expect(frame).toContain("p3");
		expect(frame).not.toContain("p4");
		expect(frame).not.toContain("p7");
		// The overflow line is present with the correct count.
		expect(frame).toContain("4 more running");
		// Header still shows full discovered count.
		expect(frame).toContain("Projects (8):");
		cleanup();
	});
});

describe("StreamApp — single-project shape Live region cap", () => {
	it("caps the Live region's running rows and adds an overflow line when more modules run concurrently than fit", () => {
		const events: RunEvent[] = [
			{ _tag: "RunStarted", runId: "r1", startedAt: "2026-05-20T00:00:00.000Z", configHash: "h" },
		];
		const projectName = "myproject";
		for (let i = 0; i < 8; i++) {
			const path = `src/module${i}.test.ts`;
			events.push({ _tag: "ModuleQueued", modulePath: path, projectName });
			events.push({
				_tag: "ModuleStarted",
				modulePath: path,
				startedAt: "2026-05-20T00:00:00.000Z",
				projectName,
			});
		}
		const state = reduceRenderStateAll(events);
		const { frame, cleanup } = renderInk(<StreamApp state={state} frameIndex={0} nowMs={Date.now()} />);
		// Only the first 4 modules appear by path in the Live region.
		expect(frame).toContain("module0");
		expect(frame).toContain("module3");
		expect(frame).not.toContain("module4");
		expect(frame).not.toContain("module7");
		// The overflow line is present with the correct count.
		expect(frame).toContain("4 more running");
		// Header still shows full discovered count.
		expect(frame).toContain("Modules (8):");
		cleanup();
	});
});

describe("StreamApp — watch-mode rerun", () => {
	it("resets the reducer's run-scoped state on a fresh RunStarted", () => {
		// Verify Change 1 (reducer reset) directly: the second `RunStarted`
		// wipes modules / moduleOrder / totals / coverage / trend /
		// failures / suggestedActions and leaves only the new run's
		// identity fields.
		const firstRun = run([
			{ _tag: "RunStarted", runId: "r1", startedAt: STARTED, configHash: "h" },
			{ _tag: "ModuleStarted", modulePath: "old/a.test.ts", startedAt: STARTED, projectName: "old-p" },
			{
				_tag: "ModuleFinished",
				modulePath: "old/a.test.ts",
				passCount: 3,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 10,
				projectName: "old-p",
			},
			{
				_tag: "RunFinished",
				runId: "r1",
				finishedAt: STARTED,
				passCount: 3,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 10,
			},
		]);
		const secondRun = reduceRenderStateAll(
			[
				{ _tag: "RunStarted", runId: "r2", startedAt: STARTED, configHash: "h" },
				{ _tag: "ModuleStarted", modulePath: "new/b.test.ts", startedAt: STARTED, projectName: "new-p" },
				{
					_tag: "ModuleFinished",
					modulePath: "new/b.test.ts",
					passCount: 7,
					failCount: 0,
					skipCount: 0,
					timeoutCount: 0,
					durationMs: 20,
					projectName: "new-p",
				},
				{
					_tag: "RunFinished",
					runId: "r2",
					finishedAt: STARTED,
					passCount: 7,
					failCount: 0,
					skipCount: 0,
					timeoutCount: 0,
					durationMs: 20,
				},
			],
			firstRun,
		);
		expect(secondRun.modules["new/b.test.ts"]).toBeDefined();
		expect(secondRun.modules["old/a.test.ts"]).toBeUndefined();
		expect(secondRun.runId).toBe("r2");
	});

	it("renders the second run's state without any modules from the first run", () => {
		// Reduce a full two-run sequence end-to-end. The reducer reset
		// guarantees the rendered output of run #2 contains only run #2's
		// modules.
		const secondRunState = reduceRenderStateAll([
			// Run #1 — populates state with `old/a.test.ts` under `alpha`.
			{ _tag: "RunStarted", runId: "r1", startedAt: STARTED, configHash: "h" },
			{ _tag: "ModuleStarted", modulePath: "old/a.test.ts", startedAt: STARTED, projectName: "alpha" },
			{
				_tag: "ModuleFinished",
				modulePath: "old/a.test.ts",
				passCount: 3,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 10,
				projectName: "alpha",
			},
			{ _tag: "ModuleStarted", modulePath: "old/b.test.ts", startedAt: STARTED, projectName: "beta" },
			{
				_tag: "ModuleFinished",
				modulePath: "old/b.test.ts",
				passCount: 4,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 10,
				projectName: "beta",
			},
			{
				_tag: "RunFinished",
				runId: "r1",
				finishedAt: STARTED,
				passCount: 7,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 20,
			},
			// Run #2 — fresh `RunStarted` wipes the prior state.
			{ _tag: "RunStarted", runId: "r2", startedAt: STARTED, configHash: "h" },
			{ _tag: "ModuleStarted", modulePath: "new/c.test.ts", startedAt: STARTED, projectName: "gamma" },
			{
				_tag: "ModuleFinished",
				modulePath: "new/c.test.ts",
				passCount: 9,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 30,
				projectName: "gamma",
			},
			{ _tag: "ModuleStarted", modulePath: "new/d.test.ts", startedAt: STARTED, projectName: "delta" },
			{
				_tag: "ModuleFinished",
				modulePath: "new/d.test.ts",
				passCount: 11,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 30,
				projectName: "delta",
			},
			{
				_tag: "RunFinished",
				runId: "r2",
				finishedAt: STARTED,
				passCount: 20,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 60,
			},
		]);
		// The reducer reset wiped run #1 from the state — the rendered
		// frame must contain only run #2's projects.
		const { frame, cleanup } = renderInk(<StreamApp state={secondRunState} frameIndex={0} nowMs={NOW} />, 80);
		expect(frame).toContain("gamma");
		expect(frame).toContain("delta");
		expect(frame).not.toContain("alpha");
		expect(frame).not.toContain("beta");
		expect(frame).not.toContain("old/a.test.ts");
		expect(frame).not.toContain("old/b.test.ts");
		cleanup();
	});
});

describe("StreamApp — fixed-column alignment", () => {
	const workspaceWithTags = () =>
		run([
			{ _tag: "RunStarted", runId: "r", startedAt: STARTED, configHash: "h" },
			{ _tag: "ModuleStarted", modulePath: "cli/a.test.ts", startedAt: STARTED, projectName: "cli" },
			{
				_tag: "ModuleFinished",
				modulePath: "cli/a.test.ts",
				passCount: 62,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 38900,
				projectName: "cli",
				tagCounts: { e2e: 25, unit: 37 },
			},
			{ _tag: "ModuleStarted", modulePath: "sdk/b.test.ts", startedAt: STARTED, projectName: "sdk" },
			{
				_tag: "ModuleFinished",
				modulePath: "sdk/b.test.ts",
				passCount: 1012,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 6300,
				projectName: "sdk",
				tagCounts: { int: 6, unit: 1006 },
			},
			{
				_tag: "RunFinished",
				runId: "r",
				finishedAt: STARTED,
				passCount: 1074,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 45200,
			},
		]);

	it("renders every union tag on every project row, zeros included", () => {
		const { frame, cleanup } = renderInk(<StreamApp state={workspaceWithTags()} frameIndex={0} nowMs={NOW} />, 100);
		// cli has no int tests; sdk has no e2e tests — both cells still render.
		expect(frame).toContain("e2e:  25  int:   0  unit:  37");
		expect(frame).toContain("e2e:   0  int:   6  unit:1006");
		cleanup();
	});

	it("aligns count and tag columns across rows of different magnitudes", () => {
		const { frame, cleanup } = renderInk(<StreamApp state={workspaceWithTags()} frameIndex={0} nowMs={NOW} />, 100);
		const lines = frame.split("\n");
		const cliLine = lines.find((l) => l.includes(" cli"));
		const sdkLine = lines.find((l) => l.includes(" sdk"));
		expect(cliLine).toBeDefined();
		expect(sdkLine).toBeDefined();
		expect(cliLine?.indexOf("✗")).toBe(sdkLine?.indexOf("✗"));
		expect(cliLine?.indexOf("⧖")).toBe(sdkLine?.indexOf("⧖"));
		expect(cliLine?.indexOf("e2e:")).toBe(sdkLine?.indexOf("e2e:"));
		cleanup();
	});

	it("suppresses tag columns entirely when the union is a single tag", () => {
		const state = run([
			{ _tag: "RunStarted", runId: "r", startedAt: STARTED, configHash: "h" },
			{ _tag: "ModuleStarted", modulePath: "cli/a.test.ts", startedAt: STARTED, projectName: "cli" },
			{
				_tag: "ModuleFinished",
				modulePath: "cli/a.test.ts",
				passCount: 62,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 38900,
				projectName: "cli",
				tagCounts: { unit: 62 },
			},
			{ _tag: "ModuleStarted", modulePath: "sdk/b.test.ts", startedAt: STARTED, projectName: "sdk" },
			{
				_tag: "ModuleFinished",
				modulePath: "sdk/b.test.ts",
				passCount: 10,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 6300,
				projectName: "sdk",
				tagCounts: { unit: 10 },
			},
			{
				_tag: "RunFinished",
				runId: "r",
				finishedAt: STARTED,
				passCount: 72,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 45200,
			},
		]);
		const { frame, cleanup } = renderInk(<StreamApp state={state} frameIndex={0} nowMs={NOW} />, 100);
		expect(frame).not.toContain("unit:");
		cleanup();
	});

	it("renders union tag cells on single-project module rows", () => {
		const state = run([
			{ _tag: "RunStarted", runId: "r", startedAt: STARTED, configHash: "h" },
			{ _tag: "ModuleStarted", modulePath: "a.test.ts", startedAt: STARTED, projectName: "mcp" },
			{
				_tag: "ModuleFinished",
				modulePath: "a.test.ts",
				passCount: 11,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 900,
				projectName: "mcp",
				tagCounts: { int: 11 },
			},
			{ _tag: "ModuleStarted", modulePath: "b.test.ts", startedAt: STARTED, projectName: "mcp" },
			{
				_tag: "ModuleFinished",
				modulePath: "b.test.ts",
				passCount: 194,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 600,
				projectName: "mcp",
				tagCounts: { unit: 194 },
			},
			{
				_tag: "RunFinished",
				runId: "r",
				finishedAt: STARTED,
				passCount: 205,
				failCount: 0,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 1500,
			},
		]);
		const { frame, cleanup } = renderInk(<StreamApp state={state} frameIndex={0} nowMs={NOW} />, 100);
		expect(frame).toContain("Modules (2):");
		expect(frame).toContain("int:  11  unit:   0");
		expect(frame).toContain("int:   0  unit: 194");
		cleanup();
	});

	it("aligns the workspace Total counts under the project-row counts", () => {
		const { frame, cleanup } = renderInk(<StreamApp state={workspaceWithTags()} frameIndex={0} nowMs={NOW} />, 100);
		const lines = frame.split("\n");
		const cliLine = lines.find((l) => l.includes(" cli"));
		const totalLine = lines.find((l) => l.includes("Total:"));
		expect(cliLine).toBeDefined();
		expect(totalLine).toBeDefined();
		expect(totalLine?.indexOf("✗")).toBe(cliLine?.indexOf("✗"));
		expect(totalLine?.indexOf("⧖")).toBe(cliLine?.indexOf("⧖"));
		cleanup();
	});
});
