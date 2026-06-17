/**
 * Unit tests for the dispatcher's pure classifiers — classifyRunShape
 * and classifyOutcome. Spec §5.1.
 *
 * Each shape × outcome combination is exercised with a canonical
 * RenderState built either from the matching event fixture or from
 * a hand-built minimal state.
 */

import type { ProjectSummary, RenderState } from "@vitest-agent/sdk";
import { initialRenderState } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { classifyOutcome, classifyRunShape } from "../src/dispatcher/classify.js";
import { reduceRenderStateAll } from "../src/reducer.js";
import {
	coverageViolationEvents,
	mixedFailEvents,
	singleFileMultiTestPassEvents,
	singleFileThresholdEvents,
	singleProjectAllPassEvents,
	singleProjectThresholdEvents,
	singleTestFailEvents,
	singleTestPassEvents,
} from "./fixtures/events.js";
import { workspaceFailProjects, workspacePassProjects } from "./fixtures/workspace.js";

describe("classifyRunShape", () => {
	it("returns single-test for one module with one test", () => {
		const state = reduceRenderStateAll(singleTestPassEvents);
		expect(classifyRunShape(state, [])).toBe("single-test");
	});

	it("returns single-file for one module with more than one test", () => {
		const state = reduceRenderStateAll(singleFileMultiTestPassEvents);
		expect(classifyRunShape(state, [])).toBe("single-file");
	});

	it("returns single-project for more than one module", () => {
		const state = reduceRenderStateAll(mixedFailEvents);
		expect(classifyRunShape(state, [])).toBe("single-project");
	});

	it("returns workspace when more than one project summary is supplied", () => {
		const state = reduceRenderStateAll(singleProjectAllPassEvents);
		expect(classifyRunShape(state, workspacePassProjects)).toBe("workspace");
	});

	it("workspace short-circuits regardless of module count", () => {
		const state = reduceRenderStateAll(singleTestPassEvents);
		expect(classifyRunShape(state, workspaceFailProjects)).toBe("workspace");
	});

	it("handles the empty-state case as single-project", () => {
		expect(classifyRunShape(initialRenderState, [])).toBe("single-project");
	});

	it("handles a single-element project summary as not-workspace", () => {
		const state = reduceRenderStateAll(singleTestPassEvents);
		const projects: ReadonlyArray<ProjectSummary> = [
			{ name: "demo", passCount: 1, failCount: 0, skipCount: 0, durationMs: 4 },
		];
		expect(classifyRunShape(state, projects)).toBe("single-test");
	});
});

describe("classifyOutcome", () => {
	it("returns all-pass for a clean state with no coverage", () => {
		const state = reduceRenderStateAll(singleTestPassEvents);
		expect(classifyOutcome(state)).toBe("all-pass");
	});

	it("returns some-fail when totals.failCount > 0", () => {
		const state = reduceRenderStateAll(singleTestFailEvents);
		expect(classifyOutcome(state)).toBe("some-fail");
	});

	it("returns threshold-violation when failCount=0 and coverage.violations is non-empty", () => {
		const state = reduceRenderStateAll(coverageViolationEvents);
		expect(classifyOutcome(state)).toBe("threshold-violation");
	});

	it("returns threshold-violation for single-file × threshold fixture", () => {
		const state = reduceRenderStateAll(singleFileThresholdEvents);
		expect(classifyOutcome(state)).toBe("threshold-violation");
	});

	it("returns threshold-violation for single-project × threshold fixture", () => {
		const state = reduceRenderStateAll(singleProjectThresholdEvents);
		expect(classifyOutcome(state)).toBe("threshold-violation");
	});

	it("some-fail wins over threshold-violation when both apply", () => {
		// Hand-built state with failures AND coverage violations: outcome should be some-fail.
		const state: RenderState = {
			...initialRenderState,
			phase: "finished",
			totals: { passCount: 1, failCount: 1, skipCount: 0, timeoutCount: 0, durationMs: 10 },
			coverage: {
				metrics: { lines: 50, branches: 50, functions: 50, statements: 50 },
				thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
				gaps: [],
				violations: [{ metric: "lines", expected: 80, actual: 50 }],
			},
		};
		expect(classifyOutcome(state)).toBe("some-fail");
	});

	it("returns all-pass when coverage block is present but has no violations", () => {
		const state: RenderState = {
			...initialRenderState,
			phase: "finished",
			totals: { passCount: 5, failCount: 0, skipCount: 0, timeoutCount: 0, durationMs: 50 },
			coverage: {
				metrics: { lines: 95, branches: 90, functions: 100, statements: 95 },
				thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
				gaps: [],
				violations: [],
			},
		};
		expect(classifyOutcome(state)).toBe("all-pass");
	});
});
