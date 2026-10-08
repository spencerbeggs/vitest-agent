/**
 * Per-cell Ink-half snapshot tests for the shape-tailored dispatcher
 * matrix. Captures the visible-text frame each cell's Ink renderer
 * produces; pins one snapshot per cell under
 * `packages/ui/__test__/snapshots/dispatcher/color/<cell-name>.ink.color.txt`.
 *
 * Colour twin of `cells.ink.snapshot.test.tsx`: the same inputs, but the
 * raw frame is kept with its SGR sequences rewritten to `{tag}` markers
 * (Ink's chalk forced to truecolor), so the glyph and line colouring the
 * dispatcher applies is pinned too.
 */

import type { CellOptions, DispatchInputs, RenderState, TrendSummary } from "@vitest-agent/sdk";
import { initialRenderState } from "@vitest-agent/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classifyOutcome, classifyRunShape } from "../../src/dispatcher/classify.js";
import { dispatchInk } from "../../src/ink/dispatch-ink.js";
import { reduceRenderStateAll } from "../../src/reducer.js";
import { ansiToTags, forceInkColor } from "../utils/ansi-tags.js";
import {
	mixedFailEvents,
	singleFileMultiTestPassEvents,
	singleFileThresholdEvents,
	singleProjectAllPassEvents,
	singleProjectThresholdEvents,
	singleTestFailEvents,
	singleTestPassEvents,
} from "../utils/events.js";
import { renderInk } from "../utils/render-ink.js";
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

const captureInk = (inputs: DispatchInputs): string => {
	const element = dispatchInk(inputs, noColorOpts);
	if (element === null) return "";
	return ansiToTags(renderInk(element).rawFrame);
};

let restore: () => void = () => {};
beforeAll(async () => {
	restore = await forceInkColor();
});
afterAll(() => restore());

describe("dispatcher cells — ink-half colour snapshots", () => {
	it("single-test × all-pass", async () => {
		const state = reduceRenderStateAll(singleTestPassEvents);
		await expect(captureInk(buildInputs(state))).toMatchFileSnapshot(
			"../snapshots/dispatcher/color/single-test-pass.ink.color.txt",
		);
	});

	it("single-test × some-fail", async () => {
		const state = reduceRenderStateAll(singleTestFailEvents);
		await expect(captureInk(buildInputs(state))).toMatchFileSnapshot(
			"../snapshots/dispatcher/color/single-test-fail.ink.color.txt",
		);
	});

	it("single-file × all-pass", async () => {
		const state = reduceRenderStateAll(singleFileMultiTestPassEvents);
		await expect(captureInk(buildInputs(state))).toMatchFileSnapshot(
			"../snapshots/dispatcher/color/single-file-pass.ink.color.txt",
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
			"../snapshots/dispatcher/color/single-file-fail.ink.color.txt",
		);
	});

	it("single-file × threshold-violation", async () => {
		const state = reduceRenderStateAll(singleFileThresholdEvents);
		await expect(captureInk(buildInputs(state))).toMatchFileSnapshot(
			"../snapshots/dispatcher/color/single-file-threshold.ink.color.txt",
		);
	});

	it("single-project × all-pass", async () => {
		const state = reduceRenderStateAll(singleProjectAllPassEvents);
		await expect(captureInk(buildInputs(state))).toMatchFileSnapshot(
			"../snapshots/dispatcher/color/single-project-pass.ink.color.txt",
		);
	});

	it("single-project × some-fail", async () => {
		const state = reduceRenderStateAll(mixedFailEvents);
		await expect(captureInk(buildInputs(state))).toMatchFileSnapshot(
			"../snapshots/dispatcher/color/single-project-fail.ink.color.txt",
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
			"../snapshots/dispatcher/color/single-project-threshold.ink.color.txt",
		);
	});

	it("workspace × all-pass", async () => {
		const inputs = buildInputs(initialRenderState, {
			projects: workspacePassProjects,
			trend: regressingTrend,
		});
		await expect(captureInk(inputs)).toMatchFileSnapshot("../snapshots/dispatcher/color/workspace-pass.ink.color.txt");
	});

	it("workspace × some-fail", async () => {
		const state = reduceRenderStateAll(mixedFailEvents);
		const inputs = buildInputs(state, {
			projects: workspaceFailProjects,
			outcome: "some-fail",
			shape: "workspace",
		});
		await expect(captureInk(inputs)).toMatchFileSnapshot("../snapshots/dispatcher/color/workspace-fail.ink.color.txt");
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
		await expect(captureInk(inputs)).toMatchFileSnapshot(
			"../snapshots/dispatcher/color/workspace-threshold.ink.color.txt",
		);
	});

	it("single-test × threshold-violation no-op returns empty string from dispatchInk", () => {
		const state = reduceRenderStateAll(singleTestPassEvents);
		const inputs = buildInputs(state, { outcome: "threshold-violation", shape: "single-test" });
		// single-test-threshold has no agent-string content; its ink half
		// returns an empty re-expression. The captured frame is empty.
		expect(
			captureInk(inputs)
				.replace(/\{[^}]*\}/g, "")
				.trim(),
		).toBe("");
	});
});
