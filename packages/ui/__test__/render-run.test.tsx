import { describe, expect, it } from "vitest";
import { reduceRenderStateAll, renderAgent, renderRun, renderRunFromState } from "../src/index.js";
import { allPassEvents, coverageViolationEvents, flakyRecoveryEvents, mixedFailEvents } from "./fixtures/events.js";
import { stripAnsi } from "./utils/render-ink.js";

describe("renderRun — agent mode parity", () => {
	it.each([
		["all-pass", allPassEvents],
		["mixed-fail", mixedFailEvents],
		["coverage-violation", coverageViolationEvents],
		["flaky-recovery", flakyRecoveryEvents],
	])("agent mode returns the same string as renderAgent for %s", (_, events) => {
		const viaRun = renderRun(events, "agent");
		const viaDirect = renderAgent(reduceRenderStateAll(events));
		expect(viaRun).toBe(viaDirect);
	});
});

describe("renderRun — human mode produces an Ink-rendered frame", () => {
	it("renders a recognizable header line for all-pass", () => {
		const frame = stripAnsi(renderRun(allPassEvents, "human"));
		expect(frame).toContain("Tests: 1/1 passed (80ms)");
	});

	it("renders a Failures block for mixed-fail", () => {
		const frame = stripAnsi(renderRun(mixedFailEvents, "human"));
		expect(frame).toContain("Failures");
		expect(frame).toContain("src/math.test.ts");
		expect(frame).toContain("divides");
		expect(frame).toContain("[new-failure]");
	});

	it("renders a Coverage section for coverage-violation", () => {
		const frame = stripAnsi(renderRun(coverageViolationEvents, "human"));
		expect(frame).toContain("Coverage");
		expect(frame).toContain("72.5%");
		expect(frame).toContain("Violations");
	});
});

describe("renderRun — determinism", () => {
	it("returns byte-identical output for repeat agent-mode calls", () => {
		const first = renderRun(mixedFailEvents, "agent");
		const second = renderRun(mixedFailEvents, "agent");
		expect(first).toBe(second);
	});

	it("returns byte-identical output for repeat human-mode calls", () => {
		const first = renderRun(allPassEvents, "human");
		const second = renderRun(allPassEvents, "human");
		expect(first).toBe(second);
	});
});

describe("renderRun — options threading", () => {
	it("respects width in agent mode for gap caps", () => {
		const out = renderRun(coverageViolationEvents, "agent", {
			width: 80,
			agent: { maxCoverageGaps: 0 },
		});
		expect(out).not.toContain("Gaps:");
	});

	it("respects width in human mode by changing the rendered frame", () => {
		const narrow = stripAnsi(renderRun(mixedFailEvents, "human", { width: 50 }));
		const wide = stripAnsi(renderRun(mixedFailEvents, "human", { width: 200 }));
		// Width changes are detectable: the frames are different but share
		// the same logical content. We just assert they aren't identical so
		// the column option is provably load-bearing.
		expect(narrow).not.toBe(wide);
		expect(narrow).toContain("Failures");
		expect(wide).toContain("Failures");
	});

	it("respects human-mode showModuleTests option", () => {
		const withTests = stripAnsi(renderRun(mixedFailEvents, "human", { human: { showModuleTests: true } }));
		expect(withTests).toContain("✓ math > adds");
	});
});

describe("renderRunFromState — direct state entry point", () => {
	it("matches renderRun when fed the same reduced state", () => {
		const state = reduceRenderStateAll(mixedFailEvents);
		const fromState = renderRunFromState(state, "agent");
		const fromEvents = renderRun(mixedFailEvents, "agent");
		expect(fromState).toBe(fromEvents);
	});
});
