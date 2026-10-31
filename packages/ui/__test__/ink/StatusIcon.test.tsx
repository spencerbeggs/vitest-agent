import { describe, expect, it } from "vitest";
import type { StatusIconKind } from "../../src/ink/index.js";
import { StatusIcon } from "../../src/ink/index.js";
import { renderInk } from "../utils/render-ink.js";

const allStatuses: ReadonlyArray<StatusIconKind> = [
	"passed",
	"failed",
	"skipped",
	"pending",
	"running",
	"queued",
	"finished",
];

describe("StatusIcon", () => {
	for (const status of allStatuses) {
		it(`renders a single-character glyph for ${status}`, async () => {
			const { frame } = await renderInk(<StatusIcon status={status} />);
			expect(frame.length).toBeGreaterThan(0);
			expect(frame.split("\n")[0]?.length).toBe(1);
		});
	}

	it("uses distinct glyphs for passed vs failed", async () => {
		const passed = await renderInk(<StatusIcon status="passed" />);
		const failed = await renderInk(<StatusIcon status="failed" />);
		expect(passed.frame).not.toBe(failed.frame);
	});
});
