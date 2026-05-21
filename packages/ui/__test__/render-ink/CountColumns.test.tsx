import { describe, expect, it } from "vitest";
import { CountColumns } from "../../src/render-ink/CountColumns.js";
import { renderInk } from "../utils/render-ink.js";

describe("CountColumns", () => {
	it("renders all four counts in pass / fail / skip / timeout order", () => {
		const { frame, cleanup } = renderInk(
			<CountColumns passCount={248} failCount={12} skipCount={5} timeoutCount={2} />,
			80,
		);
		expect(frame).toBe("248✓  12✗  5↷  2⧖");
		cleanup();
	});

	it("still renders zero counts (they are dimmed, not omitted)", () => {
		const { frame, cleanup } = renderInk(
			<CountColumns passCount={961} failCount={0} skipCount={0} timeoutCount={0} />,
			80,
		);
		expect(frame).toBe("961✓  0✗  0↷  0⧖");
		cleanup();
	});
});
