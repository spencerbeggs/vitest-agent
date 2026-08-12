/**
 * Per-cell agent-half snapshot tests for the shape-tailored
 * dispatcher matrix. Each live cell (eleven total — the
 * `single-test × threshold-violation` no-op is omitted) gets one
 * snapshot pinned under
 * `packages/ui/__test__/snapshots/dispatcher/<cell-name>.snap.txt`.
 *
 * The reducer derives the per-shape `RenderState` from the matching
 * event sequence; the workspace cells consume hand-built
 * `ProjectSummary[]` fixtures directly because events do not carry
 * project identity.
 */

import type { CellOptions, DispatchInputs, ProjectSummary, RenderState, TrendSummary } from "@vitest-agent/sdk";
import { initialRenderState } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { classifyOutcome, classifyRunShape } from "../../src/dispatcher/classify.js";
import { dispatch } from "../../src/dispatcher/dispatch.js";
import { reduceRenderStateAll } from "../../src/reducer.js";
import {
	mixedFailEvents,
	singleFileMultiTestPassEvents,
	singleFileThresholdEvents,
	singleProjectAllPassEvents,
	singleProjectThresholdEvents,
	singleTestFailEvents,
	singleTestPassEvents,
} from "../utils/events.js";
import {
	belowTargetFixture,
	regressingTrend,
	singleProjectBelowTarget,
	workspaceFailProjects,
	workspacePassProjects,
	workspaceThresholdProjects,
} from "../utils/workspace.js";

const noColorOpts: CellOptions = {
	noColor: true,
	osc8: (_url, label) => label,
};

const buildInputs = (state: RenderState, overrides: Partial<DispatchInputs> = {}): DispatchInputs => {
	const projects = overrides.projects ?? [];
	const shape = overrides.shape ?? classifyRunShape(state, projects);
	const outcome = overrides.outcome ?? classifyOutcome(state);
	return {
		state,
		shape,
		outcome,
		projects,
		trend: overrides.trend ?? null,
		belowTarget: overrides.belowTarget ?? [],
		runCommand: overrides.runCommand ?? null,
	};
};

describe("dispatcher cells — agent-half snapshots", () => {
	it("single-test × all-pass", async () => {
		const state = reduceRenderStateAll(singleTestPassEvents);
		const inputs = buildInputs(state);
		expect(inputs.shape).toBe("single-test");
		expect(inputs.outcome).toBe("all-pass");
		await expect(dispatch(inputs, noColorOpts)).toMatchFileSnapshot(
			"../snapshots/dispatcher/single-test-pass.snap.txt",
		);
	});

	it("single-test × some-fail", async () => {
		const state = reduceRenderStateAll(singleTestFailEvents);
		const inputs = buildInputs(state);
		expect(inputs.shape).toBe("single-test");
		expect(inputs.outcome).toBe("some-fail");
		await expect(dispatch(inputs, noColorOpts)).toMatchFileSnapshot(
			"../snapshots/dispatcher/single-test-fail.snap.txt",
		);
	});

	it("single-file × all-pass", async () => {
		const state = reduceRenderStateAll(singleFileMultiTestPassEvents);
		const inputs = buildInputs(state);
		expect(inputs.shape).toBe("single-file");
		expect(inputs.outcome).toBe("all-pass");
		await expect(dispatch(inputs, noColorOpts)).toMatchFileSnapshot(
			"../snapshots/dispatcher/single-file-pass.snap.txt",
		);
	});

	it("single-file × some-fail", async () => {
		// Trim down mixedFailEvents to a single failing module so the
		// classifier reports single-file and not single-project.
		const events = mixedFailEvents.filter((event) => {
			if ("modulePath" in event && event.modulePath === "src/strings.test.ts") return false;
			if (event._tag === "RunFinished") return true;
			return true;
		});
		// Override the RunFinished totals to match the single module.
		const trimmed = events.map((event) =>
			event._tag === "RunFinished" ? { ...event, passCount: 1, failCount: 1, skipCount: 0, durationMs: 30 } : event,
		);
		const state = reduceRenderStateAll(trimmed);
		const inputs = buildInputs(state);
		expect(inputs.shape).toBe("single-file");
		expect(inputs.outcome).toBe("some-fail");
		await expect(dispatch(inputs, noColorOpts)).toMatchFileSnapshot(
			"../snapshots/dispatcher/single-file-fail.snap.txt",
		);
	});

	it("single-file × threshold-violation", async () => {
		const state = reduceRenderStateAll(singleFileThresholdEvents);
		const inputs = buildInputs(state);
		expect(inputs.shape).toBe("single-file");
		expect(inputs.outcome).toBe("threshold-violation");
		await expect(dispatch(inputs, noColorOpts)).toMatchFileSnapshot(
			"../snapshots/dispatcher/single-file-threshold.snap.txt",
		);
	});

	it("single-project × all-pass", async () => {
		const state = reduceRenderStateAll(singleProjectAllPassEvents);
		const inputs = buildInputs(state);
		expect(inputs.shape).toBe("single-project");
		expect(inputs.outcome).toBe("all-pass");
		await expect(dispatch(inputs, noColorOpts)).toMatchFileSnapshot(
			"../snapshots/dispatcher/single-project-pass.snap.txt",
		);
	});

	it("single-project × all-pass renders the true module count on a green replay (issue #204)", () => {
		const state: RenderState = {
			...initialRenderState,
			phase: "finished",
			totals: { passCount: 59, failCount: 0, skipCount: 0, timeoutCount: 0, durationMs: 500 },
			collectedModules: 3,
		};
		const inputs = buildInputs(state);
		expect(inputs.shape).toBe("single-project");
		expect(inputs.outcome).toBe("all-pass");
		const out = dispatch(inputs, noColorOpts);
		expect(out).toContain("3 modules all-passed.");
		expect(out).not.toContain("0 modules");
	});

	it("single-project × all-pass warns instead of celebrating a zero-collected run (issue #192)", () => {
		const state: RenderState = {
			...initialRenderState,
			phase: "finished",
			totals: { passCount: 0, failCount: 0, skipCount: 0, timeoutCount: 0, durationMs: 0 },
			collectedModules: 0,
		};
		const inputs = buildInputs(state);
		expect(inputs.shape).toBe("single-project");
		expect(inputs.outcome).toBe("all-pass");
		const out = dispatch(inputs, noColorOpts);
		expect(out).toContain("0 tests collected");
		expect(out).not.toContain("all-passed");
	});

	it("single-project × all-pass never prints a 0-module count when no real count is knowable (issue #204 regression)", () => {
		// No `collectedModules` (older/hand-built report) AND an empty
		// `moduleOrder` (report replay only tracks failed modules), but a
		// nonzero total — the fallback `collected` would compute to 0 without
		// the guard, reproducing the exact "0 modules all-passed" bug.
		const state: RenderState = {
			...initialRenderState,
			phase: "finished",
			totals: { passCount: 12, failCount: 0, skipCount: 0, timeoutCount: 0, durationMs: 250 },
		};
		const inputs = buildInputs(state);
		expect(inputs.shape).toBe("single-project");
		expect(inputs.outcome).toBe("all-pass");
		const out = dispatch(inputs, noColorOpts);
		expect(out).not.toContain("0 modules");
		expect(out).toContain("Tests: 12/12 passed (250ms)");
	});

	it("single-project × all-pass counts a lone timed-out test instead of reporting 0 tests collected", () => {
		// pass=fail=skip=0 but one test timed out — the zero-collected
		// guard must fold timeoutCount into the total or this reads as
		// "0 tests collected" for a run that actually ran one test.
		const state: RenderState = {
			...initialRenderState,
			phase: "finished",
			totals: { passCount: 0, failCount: 0, skipCount: 0, timeoutCount: 1, durationMs: 100 },
			collectedModules: 1,
		};
		const inputs = buildInputs(state);
		expect(inputs.shape).toBe("single-project");
		expect(inputs.outcome).toBe("all-pass");
		const out = dispatch(inputs, noColorOpts);
		expect(out).not.toContain("0 tests collected");
		expect(out).toContain("1 module all-passed.");
	});

	it("single-project × some-fail", async () => {
		const state = reduceRenderStateAll(mixedFailEvents);
		const inputs = buildInputs(state);
		expect(inputs.shape).toBe("single-project");
		expect(inputs.outcome).toBe("some-fail");
		await expect(dispatch(inputs, noColorOpts)).toMatchFileSnapshot(
			"../snapshots/dispatcher/single-project-fail.snap.txt",
		);
	});

	it("single-project × threshold-violation", async () => {
		const state = reduceRenderStateAll(singleProjectThresholdEvents);
		const inputs = buildInputs(state, {
			belowTarget: singleProjectBelowTarget,
			trend: regressingTrend,
			runCommand: "pnpm test",
		});
		expect(inputs.shape).toBe("single-project");
		expect(inputs.outcome).toBe("threshold-violation");
		await expect(dispatch(inputs, noColorOpts)).toMatchFileSnapshot(
			"../snapshots/dispatcher/single-project-threshold.snap.txt",
		);
	});

	it("workspace × all-pass", async () => {
		const projects = workspacePassProjects;
		const inputs = buildInputs(initialRenderState, {
			projects,
			trend: regressingTrend,
		});
		expect(inputs.shape).toBe("workspace");
		expect(inputs.outcome).toBe("all-pass");
		await expect(dispatch(inputs, noColorOpts)).toMatchFileSnapshot("../snapshots/dispatcher/workspace-pass.snap.txt");
	});

	it("workspace × some-fail", async () => {
		const state = reduceRenderStateAll(mixedFailEvents);
		const projects: ReadonlyArray<ProjectSummary> = workspaceFailProjects;
		const inputs = buildInputs(state, {
			projects,
			trend: null,
			outcome: "some-fail",
			shape: "workspace",
		});
		expect(inputs.shape).toBe("workspace");
		expect(inputs.outcome).toBe("some-fail");
		await expect(dispatch(inputs, noColorOpts)).toMatchFileSnapshot("../snapshots/dispatcher/workspace-fail.snap.txt");
	});

	it("workspace × threshold-violation", async () => {
		const stateWithViolations: RenderState = {
			...initialRenderState,
			phase: "finished",
			coverage: {
				metrics: { lines: 72.5, branches: 60, functions: 85, statements: 72 },
				thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
				gaps: belowTargetFixture.map((f) => ({
					file: f.file,
					missing: {
						lines: 100 - f.summary.lines,
						branches: 100 - f.summary.branches,
						functions: 100 - f.summary.functions,
						statements: 100 - f.summary.statements,
					},
					uncoveredLines: f.uncoveredLines,
				})),
				violations: [
					{ metric: "lines", expected: 80, actual: 72.5 },
					{ metric: "branches", expected: 80, actual: 60 },
					{ metric: "functions", expected: 80, actual: 85 },
					{ metric: "statements", expected: 80, actual: 72 },
				],
			},
		};
		const projects = workspaceThresholdProjects;
		const trend: TrendSummary = regressingTrend;
		const inputs = buildInputs(stateWithViolations, {
			projects,
			trend,
			belowTarget: belowTargetFixture,
			runCommand: "pnpm test",
		});
		expect(inputs.shape).toBe("workspace");
		expect(inputs.outcome).toBe("threshold-violation");
		await expect(dispatch(inputs, noColorOpts)).toMatchFileSnapshot(
			"../snapshots/dispatcher/workspace-threshold.snap.txt",
		);
	});

	it("single-test × threshold-violation no-op falls through to empty string", () => {
		const state = reduceRenderStateAll(singleTestPassEvents);
		const inputs = buildInputs(state, { outcome: "threshold-violation", shape: "single-test" });
		expect(dispatch(inputs, noColorOpts)).toBe("");
	});
});
