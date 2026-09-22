import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { TestErrorsResultType } from "../src/tools/errors.js";
import { TestErrorsResult } from "../src/tools/errors.js";

const sampleRow = (overrides: Partial<TestErrorsResultType["errors"][number]> = {}) => ({
	id: 7,
	topStackFrameId: 42 as number | null,
	name: "AssertionError" as string | null,
	message: "expected 3 to equal 2",
	diff: "- 3\n+ 2" as string | null,
	actual: "3" as string | null,
	expected: "2" as string | null,
	stack: "at sum (playground/src/lifecycle.ts:5:3)" as string | null,
	scope: "test" as const,
	testFullName: "lifecycle > sum adds two numbers" as string | null,
	moduleFile: "playground/src/lifecycle.test.ts" as string | null,
	annotations: [] as TestErrorsResultType["errors"][number]["annotations"],
	...overrides,
});

const sample = (overrides: Partial<TestErrorsResultType> = {}, row = sampleRow()): TestErrorsResultType => ({
	project: "playground",
	count: 1,
	errors: [row],
	...overrides,
});

describe("TestErrorsResult Schema", () => {
	it("round-trips a valid payload through encode → decode", () => {
		const data = sample();
		const encoded = Schema.encodeSync(TestErrorsResult)(data);
		const decoded = Schema.decodeSync(TestErrorsResult)(encoded);
		expect(decoded).toEqual(data);
	});

	it("rejects an unknown scope value", () => {
		expect(() =>
			Schema.decodeUnknownSync(TestErrorsResult)({
				project: "p",
				count: 1,
				errors: [{ ...sampleRow(), scope: "bogus" }],
			}),
		).toThrow();
	});
});
