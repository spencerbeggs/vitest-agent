import { describe, expect, it } from "vitest";
import type { StatusIconKind } from "../../src/render-ink/index.js";
import { StatusIcon } from "../../src/render-ink/index.js";
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
		it(`renders a single-character glyph for ${status}`, () => {
			const { frame, cleanup } = renderInk(<StatusIcon status={status} />);
			expect(frame.length).toBeGreaterThan(0);
			expect(frame.split("\n")[0]?.length).toBe(1);
			cleanup();
		});
	}

	it("uses distinct glyphs for passed vs failed", () => {
		const passed = renderInk(<StatusIcon status="passed" />);
		const failed = renderInk(<StatusIcon status="failed" />);
		expect(passed.frame).not.toBe(failed.frame);
		passed.cleanup();
		failed.cleanup();
	});
});
