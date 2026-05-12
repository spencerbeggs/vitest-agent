import { describe, expect, it } from "vitest";
import { RunSummary } from "../../src/render-ink/index.js";
import { renderInk } from "../utils/render-ink.js";

describe("RunSummary", () => {
	it("renders pass-only line for an all-pass run", () => {
		const { frame, cleanup } = renderInk(
			<RunSummary phase="finished" totals={{ passCount: 5, failCount: 0, skipCount: 0, durationMs: 42 }} />,
		);
		expect(frame).toMatchInlineSnapshot(`"Tests: 5/5 passed (42ms)"`);
		cleanup();
	});

	it("includes failed and skipped counts when present", () => {
		const { frame, cleanup } = renderInk(
			<RunSummary phase="finished" totals={{ passCount: 2, failCount: 1, skipCount: 3, durationMs: 100 }} />,
		);
		expect(frame).toMatchInlineSnapshot(`"Tests: 2/6 passed, 1 failed, 3 skipped (100ms)"`);
		cleanup();
	});

	it("renders the running label while phase is running", () => {
		const { frame, cleanup } = renderInk(
			<RunSummary phase="running" totals={{ passCount: 1, failCount: 0, skipCount: 0, durationMs: 10 }} />,
		);
		expect(frame.split(":")[0]).toBe("Running");
		cleanup();
	});

	it("renders the idle label before any events arrive", () => {
		const { frame, cleanup } = renderInk(
			<RunSummary phase="idle" totals={{ passCount: 0, failCount: 0, skipCount: 0, durationMs: 0 }} />,
		);
		expect(frame.split(":")[0]).toBe("Idle");
		cleanup();
	});
});
