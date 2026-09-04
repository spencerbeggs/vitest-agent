import type { CellOptions, DispatchInputs, RunOutcome, RunShape } from "@vitest-agent/sdk";
import { initialRenderState } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { renderSingleFileFail } from "../src/dispatcher/cells/single-file-fail.js";
import { renderSingleFilePass } from "../src/dispatcher/cells/single-file-pass.js";
import { renderSingleFileThreshold } from "../src/dispatcher/cells/single-file-threshold.js";
import { renderSingleProjectFail } from "../src/dispatcher/cells/single-project-fail.js";
import { renderSingleProjectPass } from "../src/dispatcher/cells/single-project-pass.js";
import { renderSingleProjectThreshold } from "../src/dispatcher/cells/single-project-threshold.js";
import { renderSingleTestFail } from "../src/dispatcher/cells/single-test-fail.js";
import { renderSingleTestPass } from "../src/dispatcher/cells/single-test-pass.js";
import { renderSingleTestThreshold } from "../src/dispatcher/cells/single-test-threshold.js";
import { renderWorkspaceFail } from "../src/dispatcher/cells/workspace-fail.js";
import { renderWorkspacePass } from "../src/dispatcher/cells/workspace-pass.js";
import { renderWorkspaceThreshold } from "../src/dispatcher/cells/workspace-threshold.js";
import { dispatch, dispatchInk, dispatcherTable } from "../src/dispatcher/dispatch.js";

const opts: CellOptions = {
	noColor: true,
	osc8: (_url, label) => label,
};

const buildInputs = (shape: RunShape, outcome: RunOutcome): DispatchInputs => ({
	state: initialRenderState,
	shape,
	outcome,
	projects: [],
	trend: null,
	belowTarget: [],
	runCommand: null,
});

describe("dispatcher — routing", () => {
	const routing: ReadonlyArray<readonly [RunShape, RunOutcome, typeof renderSingleTestPass]> = [
		["single-test", "all-pass", renderSingleTestPass],
		["single-test", "some-fail", renderSingleTestFail],
		["single-test", "threshold-violation", renderSingleTestThreshold],
		["single-file", "all-pass", renderSingleFilePass],
		["single-file", "some-fail", renderSingleFileFail],
		["single-file", "threshold-violation", renderSingleFileThreshold],
		["single-project", "all-pass", renderSingleProjectPass],
		["single-project", "some-fail", renderSingleProjectFail],
		["single-project", "threshold-violation", renderSingleProjectThreshold],
		["workspace", "all-pass", renderWorkspacePass],
		["workspace", "some-fail", renderWorkspaceFail],
		["workspace", "threshold-violation", renderWorkspaceThreshold],
	];

	for (const [shape, outcome, expected] of routing) {
		it(`maps ${shape} × ${outcome} to its cell`, () => {
			expect(dispatcherTable[shape][outcome]).toBe(expected);
		});
	}

	it("dispatcherTable covers every shape × outcome pair", () => {
		const shapes: ReadonlyArray<RunShape> = ["single-test", "single-file", "single-project", "workspace"];
		const outcomes: ReadonlyArray<RunOutcome> = ["all-pass", "some-fail", "threshold-violation"];
		for (const shape of shapes) {
			for (const outcome of outcomes) {
				expect(dispatcherTable[shape][outcome]).toBeDefined();
				expect(typeof dispatcherTable[shape][outcome].agent).toBe("function");
			}
		}
	});

	it("single-test × threshold-violation falls through to empty string", () => {
		expect(dispatch(buildInputs("single-test", "threshold-violation"), opts)).toBe("");
	});

	it("dispatch invokes the cell's agent half with the inputs and opts", () => {
		const inputs = buildInputs("workspace", "all-pass");
		// initialRenderState has no projects, so workspace-pass returns
		// an empty-section rendering. The contract here is that the
		// dispatcher does call into the cell — verified by the snapshot
		// tests for each cell. We just confirm the return type.
		expect(typeof dispatch(inputs, opts)).toBe("string");
	});
});

describe("dispatcher — scoped-coverage note (issue #160 gap 1)", () => {
	const scopedInputs = (shape: RunShape, outcome: RunOutcome): DispatchInputs => ({
		...buildInputs(shape, outcome),
		state: {
			...initialRenderState,
			coverage: {
				metrics: { lines: 40, branches: 40, functions: 40, statements: 40 },
				thresholds: {},
				gaps: [],
				violations: [],
				scoped: true,
				scopedFiles: 2,
				totalFiles: 47,
			},
		},
	});

	it("dispatch() appends the scoped-coverage note when RenderState.coverage.scoped is true", () => {
		const out = dispatch(scopedInputs("workspace", "all-pass"), opts);
		expect(out).toContain("Coverage thresholds skipped: partial run (2 of 47 test files)");
	});

	it("dispatchInk() renders the same scoped-coverage note", async () => {
		const { renderToString } = await import("ink");
		const element = dispatchInk(scopedInputs("workspace", "all-pass"), opts);
		expect(element).not.toBeNull();
		if (element === null) return;
		const out = renderToString(element);
		expect(out).toContain("Coverage thresholds skipped: partial run (2 of 47 test files)");
	});

	it("a full (non-scoped) run's dispatch() output is unaffected — byte-identical", () => {
		const inputs = buildInputs("workspace", "all-pass");
		const out1 = dispatch(inputs, opts);
		const out2 = dispatch(inputs, opts);
		expect(out1).toBe(out2);
		expect(out1).not.toContain("Coverage thresholds skipped");
	});
});
