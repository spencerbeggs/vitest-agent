import { describe, expect, it } from "vitest";
import type { CellOptions, DispatchInputs, RunOutcome, RunShape } from "vitest-agent-sdk";
import { initialRenderState } from "vitest-agent-sdk";
import {
	renderSingleFileFail,
	renderSingleFilePass,
	renderSingleFileThreshold,
	renderSingleProjectFail,
	renderSingleProjectPass,
	renderSingleProjectThreshold,
	renderSingleTestFail,
	renderSingleTestPass,
	renderSingleTestThreshold,
	renderWorkspaceFail,
	renderWorkspacePass,
	renderWorkspaceThreshold,
} from "../src/dispatcher/cells/index.js";
import { dispatch, dispatcherTable } from "../src/dispatcher/index.js";

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
