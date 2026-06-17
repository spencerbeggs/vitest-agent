import type { FailureRecord } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { FailureSection } from "../../src/render-ink/index.js";
import { renderInk } from "../utils/render-ink.js";

// Long failure with verbose stack and diff — worst case for narrow terminals.
const longFailure: FailureRecord = {
	modulePath: "packages/example/src/very-deeply/nested/component/SomeReallyLongName.test.ts",
	testName: "produces the expected output for an extremely long assertion message",
	suitePath: ["SomeReallyLongName", "behavior", "edge cases"],
	classification: "new-failure",
	error: {
		message:
			"expected the long-running assertion to match the equally-long expected value, but it did not match because the inputs differed",
		diff: "- the quick brown fox jumps over the lazy dog repeatedly across the field\n+ the quick brown fox jumps over the lazy cat repeatedly across the field",
		stack:
			"AssertionError: expected the long-running assertion to match\n    at Suite.<anonymous> (packages/example/src/very-deeply/nested/component/SomeReallyLongName.test.ts:42:5)\n    at processTicksAndRejections (node:internal/process/task_queues:96:5)\n    at runMicrotasks (<anonymous>)",
	},
};

describe("FailureSection — width edge cases", () => {
	it("narrow 50-col terminal wraps long detail lines", async () => {
		const { frame, cleanup } = renderInk(<FailureSection failures={[longFailure]} includeStack />, 50);
		await expect(frame).toMatchFileSnapshot("../snapshots/render-ink/width/narrow-50.txt");
		cleanup();
	});

	it("default 80-col terminal", async () => {
		const { frame, cleanup } = renderInk(<FailureSection failures={[longFailure]} includeStack />, 80);
		await expect(frame).toMatchFileSnapshot("../snapshots/render-ink/width/default-80.txt");
		cleanup();
	});

	it("wide 200-col terminal does not pad short lines", async () => {
		const { frame, cleanup } = renderInk(<FailureSection failures={[longFailure]} includeStack />, 200);
		await expect(frame).toMatchFileSnapshot("../snapshots/render-ink/width/wide-200.txt");
		// Sanity-check: max visible line width should not exceed 200.
		const maxLine = frame.split("\n").reduce((acc, line) => Math.max(acc, line.length), 0);
		expect(maxLine).toBeLessThanOrEqual(200);
		cleanup();
	});
});
