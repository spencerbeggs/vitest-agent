import { describe, expect, it } from "vitest";
import { coerceErrorText } from "../src/utils/coerce-error-text.js";

describe("coerceErrorText", () => {
	it("passes strings through and maps nullish to undefined", () => {
		expect(coerceErrorText("boom")).toBe("boom");
		expect(coerceErrorText(undefined)).toBeUndefined();
		expect(coerceErrorText(null)).toBeUndefined();
	});

	it("stringifies primitives and plain objects", () => {
		expect(coerceErrorText(42)).toBe("42");
		expect(coerceErrorText({ a: 1 })).toBe('{"a":1}');
	});

	it("survives objects whose getters throw (ConfigError shape, issue #193)", () => {
		const nullProtoCause = Object.create(null);
		const err: Record<string, unknown> = { cause: nullProtoCause };
		Object.defineProperty(err, "message", {
			get() {
				return (this as { cause: { toString(): string } }).cause.toString();
			},
			enumerable: true,
		});
		expect(() => coerceErrorText(err)).not.toThrow();
		expect(typeof coerceErrorText(err)).toBe("string");
	});

	it("falls back for values JSON cannot represent", () => {
		expect(typeof coerceErrorText(() => 1)).toBe("string");
		expect(typeof coerceErrorText(Symbol("x"))).toBe("string");
	});
});
