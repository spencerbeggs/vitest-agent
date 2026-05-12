import { describe, expect, it } from "vitest";
import { SuggestedActions } from "../../src/render-ink/index.js";
import { renderInk } from "../utils/render-ink.js";

describe("SuggestedActions", () => {
	it("renders nothing when there are no actions", () => {
		const { frame, cleanup } = renderInk(<SuggestedActions actions={[]} />);
		expect(frame).toBe("");
		cleanup();
	});

	it("renders all three severities with optional tool hint", () => {
		const { frame, cleanup } = renderInk(
			<SuggestedActions
				actions={[
					{ severity: "info", title: "Inspect retry logic", detail: "alpha detail" },
					{
						severity: "warn",
						title: "Floating-point comparison",
						detail: "beta detail",
						targetTool: "run_tests",
					},
					{ severity: "blocker", title: "Coverage failing", detail: "gamma detail" },
				]}
			/>,
		);
		expect(frame).toMatchInlineSnapshot(`
			"Actions
			  info: Inspect retry logic
			    alpha detail
			  warn: Floating-point comparison (tool: run_tests)
			    beta detail
			  blocker: Coverage failing
			    gamma detail"
		`);
		cleanup();
	});
});
