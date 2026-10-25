/**
 * File links in the dispatcher cells and the Ink components (issue #541).
 *
 * A cell writes a test-file or coverage-file path through
 * `CellOptions.link`, the kit's `CliLinks.linker`: a human at a terminal
 * that renders OSC 8 gets a hyperlink, an agent (or a caller that passes no
 * writer) gets the path alone. The Ink tree reads the same writer from
 * `FileLinkProvider`. The kit's `layerTest` links absolute paths only, so the
 * fixtures here use absolute module and coverage paths.
 */

import { CliLinks } from "@effected/cli";
import type { CoverageRenderState, DispatchInputs, FileCoverageReport, RenderState, RunEvent } from "@vitest-agent/sdk";
import { Effect } from "effect";
import { Box } from "ink";
import { render as inkRender } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { classifyOutcome, classifyRunShape } from "../../src/dispatcher/classify.js";
import { dispatch } from "../../src/dispatcher/dispatch.js";
import { CoverageBlock } from "../../src/ink/CoverageBlock.js";
import { FailuresSection } from "../../src/ink/FailuresSection.js";
import { FileLinkProvider } from "../../src/ink/FileLink.js";
import { reduceRenderStateAll } from "../../src/reducer.js";
import { renderInk } from "../utils/render-ink.js";

const OSC8 = "\u001b]8;;";
const MODULE = "/repo/src/math.test.ts";
const COVERED = "/repo/src/math.ts";

const vscode = Effect.runSync(CliLinks.pipe(Effect.provide(CliLinks.layerTest("vscode"))));
const humanLink = CliLinks.linker({ links: vscode, hyperlinks: true, audience: "human" });
const agentLink = CliLinks.linker({ links: vscode, hyperlinks: true, audience: "agent" });
const noHyperlinks = CliLinks.linker({ links: vscode, hyperlinks: false, audience: "human" });

const failingRun: ReadonlyArray<RunEvent> = [
	{ _tag: "RunStarted", runId: "r1", startedAt: "2026-05-12T00:00:00.000Z", configHash: "cfg" },
	{ _tag: "ModuleQueued", modulePath: MODULE },
	{ _tag: "ModuleStarted", modulePath: MODULE, startedAt: "2026-05-12T00:00:00.050Z" },
	{ _tag: "TestStarted", modulePath: MODULE, testName: "adds", suitePath: ["math"] },
	{
		_tag: "TestFinished",
		modulePath: MODULE,
		testName: "adds",
		suitePath: ["math"],
		status: "failed",
		durationMs: 4,
		error: { message: "expected 1 to be 2" },
	},
	{ _tag: "TestStarted", modulePath: MODULE, testName: "subtracts", suitePath: ["math"] },
	{
		_tag: "TestFinished",
		modulePath: MODULE,
		testName: "subtracts",
		suitePath: ["math"],
		status: "passed",
		durationMs: 2,
	},
	{ _tag: "ModuleFinished", modulePath: MODULE, passCount: 1, failCount: 1, skipCount: 0, durationMs: 6 },
	{
		_tag: "RunFinished",
		runId: "r1",
		finishedAt: "2026-05-12T00:00:01.000Z",
		passCount: 1,
		failCount: 1,
		skipCount: 0,
		durationMs: 100,
	},
];

const belowTarget: ReadonlyArray<FileCoverageReport> = [
	{
		file: COVERED,
		summary: { lines: 60, branches: 50, functions: 70, statements: 60 },
		uncoveredLines: "10-14",
	},
];

const inputsOf = (state: RenderState, overrides: Partial<DispatchInputs> = {}): DispatchInputs => {
	const projects = overrides.projects ?? [];
	return {
		state,
		shape: overrides.shape ?? classifyRunShape(state, projects),
		outcome: overrides.outcome ?? classifyOutcome(state),
		projects,
		trend: null,
		belowTarget: overrides.belowTarget ?? [],
		runCommand: null,
	};
};

const ESC = String.fromCharCode(27);
const OSC8_PATTERN = new RegExp(`${ESC}\\]8;;[^${ESC}]*${ESC}\\\\`, "g");
const stripOsc8 = (text: string): string => text.replaceAll(OSC8_PATTERN, "");

describe("dispatcher cells — file links (#541)", () => {
	const failing = inputsOf(reduceRenderStateAll(failingRun));

	it("no writer: the failure row is the path alone, with no escape of any kind", () => {
		const out = dispatch(failing, {});
		expect(out).toContain(`- ${MODULE} > math > adds`);
		expect(out).not.toContain("\u001b");
	});

	it("a human writer wraps the failure row's test file in an OSC 8 link to the editor", () => {
		const out = dispatch(failing, { link: humanLink });
		expect(out).toContain(
			`${OSC8}vscode://file/repo/src/math.test.ts\u001b\\${MODULE}\u001b]8;;\u001b\\ > math > adds`,
		);
		// The link wraps the path alone; the visible text is unchanged.
		expect(stripOsc8(out)).toBe(dispatch(failing, {}));
	});

	it("an agent writer and a terminal without hyperlinks both write the path alone", () => {
		expect(dispatch(failing, { link: agentLink })).toBe(dispatch(failing, {}));
		expect(dispatch(failing, { link: noHyperlinks })).toBe(dispatch(failing, {}));
	});

	it("the below-target table links each coverage file and keeps its columns aligned", () => {
		const state = reduceRenderStateAll(failingRun);
		const inputs = inputsOf(
			{ ...state, totals: { ...state.totals, failCount: 0 } },
			{
				shape: "single-project",
				outcome: "threshold-violation",
				belowTarget,
			},
		);
		const linked = dispatch(inputs, { link: humanLink });
		expect(linked).toContain(`${OSC8}vscode://file/repo/src/math.ts\u001b\\${COVERED}\u001b]8;;\u001b\\`);
		expect(stripOsc8(linked)).toBe(dispatch(inputs, {}));
	});
});

describe("Ink components — file links (#541)", () => {
	const coverage: CoverageRenderState = {
		metrics: { lines: 60, branches: 50, functions: 70, statements: 60 },
		thresholds: { lines: 80 },
		gaps: [{ file: COVERED, missing: { lines: 5, branches: 1, functions: 0, statements: 5 }, uncoveredLines: "10-14" }],
		violations: [{ metric: "lines", expected: 80, actual: 60 }],
	};

	it("a coverage gap's file is linked under a FileLinkProvider, and plain without one", () => {
		const linked = inkRender(
			<FileLinkProvider link={humanLink}>
				<Box width={200}>
					<CoverageBlock coverage={coverage} />
				</Box>
			</FileLinkProvider>,
		);
		expect(linked.lastFrame()).toContain(`${OSC8}vscode://file/repo/src/math.ts`);
		linked.unmount();
		const plain = inkRender(
			<Box width={200}>
				<CoverageBlock coverage={coverage} />
			</Box>,
		);
		expect(plain.lastFrame()).toContain(COVERED);
		expect(plain.lastFrame()).not.toContain(OSC8);
		plain.unmount();
	});

	it("a failure row's test file is linked under a FileLinkProvider", () => {
		const state = reduceRenderStateAll(failingRun);
		const result = renderInk(
			<FileLinkProvider link={humanLink}>
				<FailuresSection failures={state.failures} limit={5} />
			</FileLinkProvider>,
			200,
		);
		expect(result.rawFrame).toContain(`${OSC8}vscode://file/repo/src/math.test.ts`);
		expect(result.frame).toContain("math › adds");
		result.cleanup();
	});
});
