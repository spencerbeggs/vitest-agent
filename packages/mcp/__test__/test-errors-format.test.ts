import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { TestErrorsResultType } from "../src/tools/errors.js";
import { TestErrorsAsMarkdown, TestErrorsResult, formatTestErrorsMarkdown } from "../src/tools/errors.js";

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

describe("formatTestErrorsMarkdown", () => {
	it("returns the empty-state line when given no errors", () => {
		expect(formatTestErrorsMarkdown(sample({ count: 0, errors: [] }))).toBe(
			"No errors found for project `playground`.",
		);
	});

	it("surfaces testErrorId and topStackFrameId in the heading and a dedicated cite-able-IDs block", () => {
		const md = formatTestErrorsMarkdown(sample());
		expect(md).toContain("[testErrorId=7 topStackFrameId=42]");
		expect(md).toContain("**Cite-able IDs (for `hypothesis (action: record)`):**");
		expect(md).toContain("- citedTestErrorId: 7");
		expect(md).toContain("- citedStackFrameId: 42");
	});

	it("falls back to a 'no stack frames' note when topStackFrameId is null", () => {
		const md = formatTestErrorsMarkdown(sample({}, sampleRow({ topStackFrameId: null })));
		expect(md).toContain("[testErrorId=7]");
		expect(md).not.toContain("topStackFrameId=");
		expect(md).toContain("- citedStackFrameId: (none — no stack frames recorded for this error)");
	});

	it("renders diff as a fenced diff block", () => {
		const md = formatTestErrorsMarkdown(sample());
		expect(md).toContain("```diff");
		expect(md).toContain("- 3");
		expect(md).toContain("+ 2");
	});

	it("truncates diff longer than 500 chars and marks the truncation", () => {
		const long = "+".repeat(700);
		const md = formatTestErrorsMarkdown(sample({}, sampleRow({ diff: long })));
		expect(md).toContain("... (truncated)");
		const snippet = md.split("```diff")[1].split("```")[0];
		expect(snippet.length).toBeLessThan(700);
	});
});

describe("TestErrorsAsMarkdown (Schema.transformOrFail)", () => {
	it("decode is the rendering direction (structured → markdown)", () => {
		const md = Schema.decodeSync(TestErrorsAsMarkdown)(sample());
		expect(md).toContain("# Test Errors — playground");
		expect(md).toContain("[testErrorId=7 topStackFrameId=42]");
	});

	it("decode produces the same string as the standalone formatter", () => {
		const data = sample();
		expect(Schema.decodeSync(TestErrorsAsMarkdown)(data)).toBe(formatTestErrorsMarkdown(data));
	});

	it("encode is forbidden — markdown cannot be parsed back", () => {
		expect(() => Schema.encodeSync(TestErrorsAsMarkdown)("# arbitrary markdown")).toThrow(
			/one-way|cannot be parsed back/i,
		);
	});
});
