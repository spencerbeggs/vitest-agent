import type { FailureRecord } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { FailureSection } from "../../src/ink/index.js";
import { renderInk } from "../utils/render-ink.js";

const failureOf = (overrides: Partial<FailureRecord> = {}): FailureRecord => ({
	modulePath: "src/math.test.ts",
	testName: "divides",
	suitePath: ["math"],
	classification: "new-failure",
	error: {
		message: "expected 0.5 to equal 0.5000001",
		diff: "- 0.5000001\n+ 0.5",
	},
	...overrides,
});

describe("FailureSection", () => {
	it("renders nothing when there are no failures", async () => {
		const { frame } = await renderInk(<FailureSection failures={[]} />);
		expect(frame).toBe("");
	});

	it("renders a single failure with classification, message, and diff", async () => {
		const { frame } = await renderInk(<FailureSection failures={[failureOf()]} />);
		expect(frame).toMatchInlineSnapshot(`
			"Failures
			✗ src/math.test.ts > math > divides [new-failure]
			  expected 0.5 to equal 0.5000001
			  - 0.5000001
			  + 0.5"
		`);
	});

	it("omits the classification tag when null", async () => {
		const { frame } = await renderInk(<FailureSection failures={[failureOf({ classification: null })]} />);
		expect(frame).not.toContain("[");
	});

	it("renders multiple failures back to back", async () => {
		const { frame } = await renderInk(
			<FailureSection
				failures={[
					failureOf({ testName: "divides" }),
					failureOf({ testName: "modulo", classification: "flaky", error: { message: "NaN" } }),
				]}
			/>,
		);
		expect(frame).toContain("✗ src/math.test.ts > math > divides [new-failure]");
		expect(frame).toContain("✗ src/math.test.ts > math > modulo [flaky]");
	});

	it("includes the stack when includeStack is true", async () => {
		const { frame } = await renderInk(
			<FailureSection
				failures={[
					failureOf({
						error: {
							message: "boom",
							stack: "Error\n    at fn (src/math.ts:10:5)",
						},
					}),
				]}
				includeStack
			/>,
		);
		expect(frame).toContain("at fn (src/math.ts:10:5)");
	});
});
