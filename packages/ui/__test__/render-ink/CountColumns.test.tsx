import { describe, expect, it } from "vitest";
import { CountColumns, DURATION_CELL_WIDTH } from "../../src/render-ink/CountColumns.js";
import { renderInk } from "../utils/render-ink.js";

describe("CountColumns", () => {
	it("renders all four counts right-aligned in fixed 4-digit cells", () => {
		const { frame, cleanup } = renderInk(
			<CountColumns passCount={248} failCount={12} skipCount={5} timeoutCount={2} />,
			80,
		);
		expect(frame).toBe(" 248✓    12✗     5↷     2⧖");
		cleanup();
	});

	it("still renders zero counts (they are dimmed, not omitted) in aligned cells", () => {
		const { frame, cleanup } = renderInk(
			<CountColumns passCount={961} failCount={0} skipCount={0} timeoutCount={0} />,
			80,
		);
		expect(frame).toBe(" 961✓     0✗     0↷     0⧖");
		cleanup();
	});

	it("keeps a 4-digit count flush in its cell", () => {
		const { frame, cleanup } = renderInk(
			<CountColumns passCount={1012} failCount={0} skipCount={0} timeoutCount={0} />,
			80,
		);
		expect(frame).toBe("1012✓     0✗     0↷     0⧖");
		cleanup();
	});

	it("exposes the shared duration cell width", () => {
		expect(DURATION_CELL_WIDTH).toBe(7);
	});
});
