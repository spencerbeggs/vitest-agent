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
} from "../fixtures/events.js";
import {
	belowTargetFixture,
	regressingTrend,
	singleProjectBelowTarget,
	workspaceFailProjects,
	workspacePassProjects,
	workspaceThresholdProjects,
} from "../fixtures/workspace.js";

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
