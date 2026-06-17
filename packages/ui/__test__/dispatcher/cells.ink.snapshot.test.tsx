/**
 * Per-cell Ink-half snapshot tests for the shape-tailored dispatcher
 * matrix. Captures the visible-text frame each cell's Ink renderer
 * produces; pins one snapshot per cell under
 * `packages/ui/__test__/snapshots/dispatcher/<cell-name>.ink.snap.txt`.
 *
 * The Ink half of every cell is a mechanical re-expression of the
 * agent half. Stripping ANSI from the rendered frame keeps the
 * snapshot file readable and stable across terminal-color toggles.
 */

import type { CellOptions, DispatchInputs, RenderState, TrendSummary } from "@vitest-agent/sdk";
import { initialRenderState } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { classifyOutcome, classifyRunShape } from "../../src/dispatcher/classify.js";
import { dispatchInk } from "../../src/dispatcher/dispatch.js";
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
import { renderInk } from "../utils/render-ink.js";

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

const captureInk = (inputs: DispatchInputs): string => {
	const element = dispatchInk(inputs, noColorOpts);
	if (element === null) return "";
	return renderInk(element).frame;
};

describe("dispatcher cells — ink-half snapshots", () => {
	it("single-test × all-pass", async () => {
		const state = reduceRenderStateAll(singleTestPassEvents);
		await expect(captureInk(buildInputs(state))).toMatchFileSnapshot(
			"../snapshots/dispatcher/single-test-pass.ink.snap.txt",
		);
	});

	it("single-test × some-fail", async () => {
		const state = reduceRenderStateAll(singleTestFailEvents);
		await expect(captureInk(buildInputs(state))).toMatchFileSnapshot(
			"../snapshots/dispatcher/single-test-fail.ink.snap.txt",
		);
	});

	it("single-file × all-pass", async () => {
		const state = reduceRenderStateAll(singleFileMultiTestPassEvents);
		await expect(captureInk(buildInputs(state))).toMatchFileSnapshot(
			"../snapshots/dispatcher/single-file-pass.ink.snap.txt",
		);
	});

	it("single-file × some-fail", async () => {
		const events = mixedFailEvents.filter(
			(event) => !("modulePath" in event) || event.modulePath !== "src/strings.test.ts",
		);
		const trimmed = events.map((event) =>
			event._tag === "RunFinished" ? { ...event, passCount: 1, failCount: 1, skipCount: 0, durationMs: 30 } : event,
		);
		const state = reduceRenderStateAll(trimmed);
		await expect(captureInk(buildInputs(state))).toMatchFileSnapshot(
			"../snapshots/dispatcher/single-file-fail.ink.snap.txt",
		);
	});

	it("single-file × threshold-violation", async () => {
		const state = reduceRenderStateAll(singleFileThresholdEvents);
		await expect(captureInk(buildInputs(state))).toMatchFileSnapshot(
			"../snapshots/dispatcher/single-file-threshold.ink.snap.txt",
		);
	});

	it("single-project × all-pass", async () => {
		const state = reduceRenderStateAll(singleProjectAllPassEvents);
		await expect(captureInk(buildInputs(state))).toMatchFileSnapshot(
			"../snapshots/dispatcher/single-project-pass.ink.snap.txt",
		);
	});

	it("single-project × some-fail", async () => {
		const state = reduceRenderStateAll(mixedFailEvents);
		await expect(captureInk(buildInputs(state))).toMatchFileSnapshot(
			"../snapshots/dispatcher/single-project-fail.ink.snap.txt",
		);
	});

	it("single-project × threshold-violation", async () => {
		const state = reduceRenderStateAll(singleProjectThresholdEvents);
		const inputs = buildInputs(state, {
			belowTarget: singleProjectBelowTarget,
			trend: regressingTrend,
			runCommand: "pnpm test",
		});
		await expect(captureInk(inputs)).toMatchFileSnapshot(
			"../snapshots/dispatcher/single-project-threshold.ink.snap.txt",
		);
	});

	it("workspace × all-pass", async () => {
		const inputs = buildInputs(initialRenderState, {
			projects: workspacePassProjects,
			trend: regressingTrend,
		});
		await expect(captureInk(inputs)).toMatchFileSnapshot("../snapshots/dispatcher/workspace-pass.ink.snap.txt");
	});

	it("workspace × some-fail", async () => {
		const state = reduceRenderStateAll(mixedFailEvents);
		const inputs = buildInputs(state, {
			projects: workspaceFailProjects,
			outcome: "some-fail",
			shape: "workspace",
		});
		await expect(captureInk(inputs)).toMatchFileSnapshot("../snapshots/dispatcher/workspace-fail.ink.snap.txt");
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
		const trend: TrendSummary = regressingTrend;
		const inputs = buildInputs(stateWithViolations, {
			projects: workspaceThresholdProjects,
			trend,
			belowTarget: belowTargetFixture,
			runCommand: "pnpm test",
		});
		await expect(captureInk(inputs)).toMatchFileSnapshot("../snapshots/dispatcher/workspace-threshold.ink.snap.txt");
	});

	it("single-test × threshold-violation no-op returns empty string from dispatchInk", () => {
		const state = reduceRenderStateAll(singleTestPassEvents);
		const inputs = buildInputs(state, { outcome: "threshold-violation", shape: "single-test" });
		// single-test-threshold has no agent-string content; its ink half
		// returns an empty re-expression. The captured frame is empty.
		expect(captureInk(inputs).trim()).toBe("");
	});
});
