import { describe, expect, it } from "vitest";
import { ProjectRow } from "../../src/render-ink/ProjectRow.js";
import { renderInk } from "../utils/render-ink.js";

const project = (over: Partial<Parameters<typeof ProjectRow>[0]["project"]> = {}) => ({
	name: "ui",
	passCount: 0,
	failCount: 0,
	skipCount: 0,
	durationMs: 0,
	...over,
});

describe("ProjectRow", () => {
	it("renders a clean finished project with a check glyph", () => {
		const { frame, cleanup } = renderInk(
			<ProjectRow
				project={project()}
				counts={{ passCount: 5, failCount: 0, skipCount: 0, timeoutCount: 0 }}
				running={false}
				elapsedMs={120}
				frame="⠋"
				nameWidth={3}
			/>,
			80,
		);
		expect(frame).toContain("✓");
		expect(frame).toContain("ui");
		expect(frame).toContain("5✓");
		cleanup();
	});

	it("renders the spinner frame while the project is running", () => {
		const { frame, cleanup } = renderInk(
			<ProjectRow
				project={project()}
				counts={{ passCount: 5, failCount: 0, skipCount: 0, timeoutCount: 0 }}
				running={true}
				elapsedMs={3000}
				frame="⠹"
				nameWidth={3}
			/>,
			80,
		);
		expect(frame).toContain("⠹");
		expect(frame).toContain("3s");
		cleanup();
	});

	it("renders a failed project with a cross glyph and the fail count", () => {
		const { frame, cleanup } = renderInk(
			<ProjectRow
				project={project()}
				counts={{ passCount: 5, failCount: 2, skipCount: 0, timeoutCount: 0 }}
				running={false}
				elapsedMs={120}
				frame="⠋"
				nameWidth={3}
			/>,
			80,
		);
		expect(frame).toContain("✗");
		expect(frame).toContain("2✗");
		cleanup();
	});

	it("renders the timeout glyph for a project carrying timeouts", () => {
		const { frame, cleanup } = renderInk(
			<ProjectRow
				project={project()}
				counts={{ passCount: 5, failCount: 0, skipCount: 0, timeoutCount: 1 }}
				running={false}
				elapsedMs={120}
				frame="⠋"
				nameWidth={3}
			/>,
			80,
		);
		expect(frame).toContain("⧖");
		expect(frame).toContain("1⧖");
		cleanup();
	});

	it("renders ↷ on a skip-only project (no passes, no fails, no timeouts)", () => {
		const { frame, cleanup } = renderInk(
			<ProjectRow
				project={project()}
				counts={{ passCount: 0, failCount: 0, skipCount: 4, timeoutCount: 0 }}
				running={false}
				elapsedMs={120}
				frame="⠋"
				nameWidth={3}
			/>,
			80,
		);
		// The status glyph (the column before the project name) must be ↷.
		// The frame begins with two-space indent then the glyph, e.g. "  ↷ ui".
		expect(frame).toMatch(/^\s+↷\s+ui\b/);
		// And not the false-positive ✓ in the glyph column.
		expect(frame).not.toMatch(/^\s+✓\s+ui\b/);
		cleanup();
	});

	it("renders ⧖ on a previously-running row when timedOut is set", () => {
		const { frame, cleanup } = renderInk(
			<ProjectRow
				project={project()}
				counts={{ passCount: 1, failCount: 0, skipCount: 0, timeoutCount: 0 }}
				running={true}
				timedOut={true}
				elapsedMs={3000}
				frame="⠹"
				nameWidth={3}
			/>,
			80,
		);
		expect(frame).toContain("⧖");
		// The spinner must not still be drawn.
		expect(frame).not.toContain("⠹");
		cleanup();
	});

	it("renders every union tag as a fixed-width cell, zeros included", () => {
		const { frame, cleanup } = renderInk(
			<ProjectRow
				project={project()}
				counts={{ passCount: 62, failCount: 0, skipCount: 0, timeoutCount: 0 }}
				running={false}
				elapsedMs={38900}
				frame="⠋"
				nameWidth={20}
				tagCounts={{ e2e: 25, unit: 37 }}
				tagUnion={["e2e", "int", "unit"]}
			/>,
			100,
		);
		expect(frame).toContain("e2e:  25  int:   0  unit:  37");
		cleanup();
	});

	it("right-aligns the duration in a fixed 7-char cell", () => {
		const { frame, cleanup } = renderInk(
			<ProjectRow
				project={project()}
				counts={{ passCount: 5, failCount: 0, skipCount: 0, timeoutCount: 0 }}
				running={false}
				elapsedMs={120}
				frame="⠋"
				nameWidth={3}
			/>,
			80,
		);
		// 120ms formats to "120ms" and pads to 7: two leading spaces.
		expect(frame).toContain("⧖   120ms");
		cleanup();
	});

	it("pins the full aligned frame for a finished row with tag columns", () => {
		const { frame, cleanup } = renderInk(
			<ProjectRow
				project={project()}
				counts={{ passCount: 62, failCount: 0, skipCount: 0, timeoutCount: 0 }}
				running={false}
				elapsedMs={38900}
				frame="⠋"
				nameWidth={3}
				tagCounts={{ e2e: 25, unit: 37 }}
				tagUnion={["e2e", "int", "unit"]}
			/>,
			100,
		);
		expect(frame).toBe("  ✓ ui    62✓     0✗     0↷     0⧖   38.9s  e2e:  25  int:   0  unit:  37");
		cleanup();
	});

	it("renders no tag cells when the tag union is empty", () => {
		const { frame, cleanup } = renderInk(
			<ProjectRow
				project={project()}
				counts={{ passCount: 5, failCount: 0, skipCount: 0, timeoutCount: 0 }}
				running={false}
				elapsedMs={120}
				frame="⠋"
				nameWidth={3}
				tagCounts={{ unit: 5 }}
			/>,
			80,
		);
		expect(frame).not.toContain("unit:");
		cleanup();
	});
});
