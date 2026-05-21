import { describe, expect, it } from "vitest";
import { stringifyFailureValue } from "../src/utils/stringify-failure-value.js";

describe("stringifyFailureValue", () => {
	it("returns undefined for undefined input", () => {
		expect(stringifyFailureValue(undefined)).toBeUndefined();
	});

	it("returns 'null' for null input", () => {
		expect(stringifyFailureValue(null)).toBe("null");
	});

	it("returns the string as-is for string input", () => {
		expect(stringifyFailureValue("hello")).toBe("hello");
	});

	it("stringifies a number", () => {
		expect(stringifyFailureValue(42)).toBe("42");
	});

	it("stringifies 0", () => {
		expect(stringifyFailureValue(0)).toBe("0");
	});

	it("stringifies a boolean true", () => {
		expect(stringifyFailureValue(true)).toBe("true");
	});

	it("stringifies a boolean false", () => {
		expect(stringifyFailureValue(false)).toBe("false");
	});

	it("stringifies a bigint", () => {
		expect(stringifyFailureValue(BigInt("9007199254740993"))).toBe("9007199254740993");
	});

	it("JSON-stringifies a plain object", () => {
		expect(stringifyFailureValue({ a: 1, b: "two" })).toBe('{"a":1,"b":"two"}');
	});

	it("JSON-stringifies an array", () => {
		expect(stringifyFailureValue([1, 2, 3])).toBe("[1,2,3]");
	});

	it("falls back to String() for a circular object", () => {
		const obj: Record<string, unknown> = {};
		obj["self"] = obj;
		const result = stringifyFailureValue(obj);
		// JSON.stringify throws on circular refs; String({}) → '[object Object]'
		expect(result).toBe("[object Object]");
	});
});
