import { describe, expect, it } from "vitest";
import type { CoverageRenderState } from "vitest-agent-sdk";
import { CoverageBlock } from "../../src/render-ink/index.js";
import { renderInk } from "../utils/render-ink.js";

const coverageOf = (overrides: Partial<CoverageRenderState> = {}): CoverageRenderState => ({
	metrics: { lines: 90, branches: 85, functions: 100, statements: 90 },
	thresholds: {},
	gaps: [],
	violations: [],
	...overrides,
});

describe("CoverageBlock", () => {
	it("renders metrics with no thresholds, no violations, no gaps", () => {
		const { frame, cleanup } = renderInk(<CoverageBlock coverage={coverageOf()} />);
		expect(frame).toMatchInlineSnapshot(`
			"Coverage
			  lines: 90%
			  branches: 85%
			  functions: 100%
			  statements: 90%"
		`);
		cleanup();
	});

	it("annotates thresholds and lists violations", () => {
		const { frame, cleanup } = renderInk(
			<CoverageBlock
				coverage={coverageOf({
					metrics: { lines: 70, branches: 60, functions: 85, statements: 72 },
					thresholds: { lines: 80, branches: 80 },
					violations: [
						{ metric: "lines", expected: 80, actual: 70 },
						{ metric: "branches", expected: 80, actual: 60 },
					],
				})}
			/>,
		);
		expect(frame).toMatchInlineSnapshot(`
			"Coverage
			  lines: 70% (threshold 80%)
			  branches: 60% (threshold 80%)
			  functions: 85%
			  statements: 72%
			Violations
			  lines: 70% < 80%
			  branches: 60% < 80%"
		`);
		cleanup();
	});

	it("lists the top-N gaps and elides the rest", () => {
		const { frame, cleanup } = renderInk(
			<CoverageBlock
				coverage={coverageOf({
					gaps: [
						{ file: "a.ts", missing: { lines: 50, branches: 0, functions: 0, statements: 0 } },
						{ file: "b.ts", missing: { lines: 40, branches: 0, functions: 0, statements: 0 } },
						{ file: "c.ts", missing: { lines: 30, branches: 0, functions: 0, statements: 0 } },
						{ file: "d.ts", missing: { lines: 20, branches: 0, functions: 0, statements: 0 } },
					],
				})}
				maxGaps={2}
			/>,
		);
		expect(frame).toContain("  a.ts");
		expect(frame).toContain("  b.ts");
		expect(frame).not.toContain("  c.ts");
		expect(frame).toContain("(+2 more gaps)");
		cleanup();
	});

	it("omits the gap section when maxGaps is 0", () => {
		const { frame, cleanup } = renderInk(
			<CoverageBlock
				coverage={coverageOf({
					gaps: [{ file: "a.ts", missing: { lines: 1, branches: 0, functions: 0, statements: 0 } }],
				})}
				maxGaps={0}
			/>,
		);
		expect(frame).not.toContain("Gaps");
		cleanup();
	});
});
