import { describe, expect, it } from "vitest";
import { computeFailureSignature, normalizeAssertionShape } from "../src/utils/failure-signature.js";

describe("normalizeAssertionShape", () => {
	it("strips literal values to type tags", () => {
		expect(normalizeAssertionShape("expect(x).toBe(42)")).toBe("toBe(<number>)");
		expect(normalizeAssertionShape('expect(x).toBe("hello")')).toBe("toBe(<string>)");
		expect(normalizeAssertionShape("expect(x).toEqual({a: 1})")).toBe("toEqual(<object>)");
	});

	it("normalizes boolean, null, and undefined literal arguments", () => {
		expect(normalizeAssertionShape("expect(x).toBe(true)")).toBe("toBe(<boolean>)");
		expect(normalizeAssertionShape("expect(x).toBe(false)")).toBe("toBe(<boolean>)");
		expect(normalizeAssertionShape("expect(x).toBe(null)")).toBe("toBe(<null>)");
		expect(normalizeAssertionShape("expect(x).toBe(undefined)")).toBe("toBe(<undefined>)");
	});

	it("normalizes array-literal arguments to <object>", () => {
		expect(normalizeAssertionShape("expect(x).toEqual([1, 2, 3])")).toBe("toEqual(<object>)");
	});

	it("normalizes decimal numeric arguments to <number>", () => {
		expect(normalizeAssertionShape("expect(x).toBeCloseTo(3.14)")).toBe("toBeCloseTo(<number>)");
	});

	it("falls through to <expr> for non-literal expression arguments", () => {
		// An identifier reference does not match number/string/boolean/null/undefined/object regexes
		expect(normalizeAssertionShape("expect(x).toBe(otherValue)")).toBe("toBe(<expr>)");
		// A unary expression (negative number) starts with `-`, not a digit, so it falls through
		expect(normalizeAssertionShape("expect(x).toBe(-1)")).toBe("toBe(<expr>)");
		// A function call is also an expression
		expect(normalizeAssertionShape("expect(x).toEqual(makeValue())")).toBe("toEqual(<expr>)");
	});

	it("preserves the matcher name when the argument list is empty", () => {
		// Empty arg list -> typeTagOf returns "" -> normalizeAssertionShape returns just the matcher
		expect(normalizeAssertionShape("expect(x).toBeNull()")).toBe("toBeNull");
		expect(normalizeAssertionShape("expect(x).toHaveBeenCalled()")).toBe("toHaveBeenCalled");
	});

	it("returns null for unrecognized shapes", () => {
		expect(normalizeAssertionShape("not an assertion")).toBeNull();
	});

	it("should normalize single-quoted string arguments to <string>", () => {
		// Given: an assertion message with a single-quoted string literal argument.
		// When: normalizeAssertionShape processes it.
		// Then: should return the matcher with <string> tag (same as double-quoted strings).
		expect(normalizeAssertionShape("expect(x).toBe('world')")).toBe("toBe(<string>)");
	});

	it("should normalize template-literal string arguments to <string>", () => {
		// Given: an assertion message with a template literal argument (backtick string).
		// When: normalizeAssertionShape processes it.
		// Then: should return the matcher with <string> tag — the regex /^["'`]/ covers backticks.
		expect(normalizeAssertionShape("expect(x).toBe(`template`)")).toBe("toBe(<string>)");
	});
});

describe("computeFailureSignature", () => {
	it("produces stable hash across line drift in unrelated code", () => {
		const a = computeFailureSignature({
			error_name: "AssertionError",
			assertion_message: "expect(x).toBe(5)",
			top_frame_function_name: "validateLogin",
			top_frame_function_boundary_line: 42,
		});
		const b = computeFailureSignature({
			error_name: "AssertionError",
			assertion_message: "expect(x).toBe(5)",
			top_frame_function_name: "validateLogin",
			top_frame_function_boundary_line: 42,
		});
		expect(a).toBe(b);
	});

	it("differs on different error.name", () => {
		const a = computeFailureSignature({
			error_name: "AssertionError",
			assertion_message: "expect(x).toBe(5)",
			top_frame_function_name: "f",
			top_frame_function_boundary_line: 1,
		});
		const b = computeFailureSignature({
			error_name: "TypeError",
			assertion_message: "expect(x).toBe(5)",
			top_frame_function_name: "f",
			top_frame_function_boundary_line: 1,
		});
		expect(a).not.toBe(b);
	});

	it("uses degraded path when function_boundary_line is null (rounds raw line)", () => {
		const a = computeFailureSignature({
			error_name: "AssertionError",
			assertion_message: "expect(x).toBe(5)",
			top_frame_function_name: "f",
			top_frame_function_boundary_line: null,
			top_frame_raw_line: 47,
		});
		const b = computeFailureSignature({
			error_name: "AssertionError",
			assertion_message: "expect(x).toBe(5)",
			top_frame_function_name: "f",
			top_frame_function_boundary_line: null,
			top_frame_raw_line: 49,
		});
		// 47 and 49 round to the same 10-bucket (40)
		expect(a).toBe(b);
	});

	it("uses raw:? fallback when both function boundary line and raw line are unknown", () => {
		// All inputs without boundary or raw line collapse to one signature per
		// (error_name, shape, function_name) tuple regardless of where they
		// originated -- this is the documented "raw:?" terminal fallback.
		const a = computeFailureSignature({
			error_name: "AssertionError",
			assertion_message: "expect(x).toBe(5)",
			top_frame_function_name: "f",
			top_frame_function_boundary_line: null,
		});
		const b = computeFailureSignature({
			error_name: "AssertionError",
			assertion_message: "expect(x).toBe(5)",
			top_frame_function_name: "f",
			top_frame_function_boundary_line: null,
		});
		expect(a).toBe(b);

		// And differs from the bucketed raw-line variant: raw:? is structurally
		// distinct from raw:0, so a no-raw-line signature is not the same as
		// a raw_line=0 signature.
		const withRaw0 = computeFailureSignature({
			error_name: "AssertionError",
			assertion_message: "expect(x).toBe(5)",
			top_frame_function_name: "f",
			top_frame_function_boundary_line: null,
			top_frame_raw_line: 0,
		});
		expect(a).not.toBe(withRaw0);
	});

	it("uses <unknown> shape fallback when assertion message is unparseable", () => {
		// When normalizeAssertionShape returns null, the signature uses the
		// literal "<unknown>" shape. Two unparseable messages with otherwise
		// identical inputs collapse to the same signature.
		const a = computeFailureSignature({
			error_name: "Error",
			assertion_message: "this is not an assertion",
			top_frame_function_name: "g",
			top_frame_function_boundary_line: 10,
		});
		const b = computeFailureSignature({
			error_name: "Error",
			assertion_message: "also not an assertion",
			top_frame_function_name: "g",
			top_frame_function_boundary_line: 10,
		});
		expect(a).toBe(b);
	});
});
