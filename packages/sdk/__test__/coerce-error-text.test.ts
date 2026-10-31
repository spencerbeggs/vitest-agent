import { Redacted } from "effect";
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
		expect(coerceErrorText(Symbol("s"))).toBe("Symbol(s)");
		expect(coerceErrorText(10n)).toBe("10n");
		expect(coerceErrorText(true)).toBe("true");
	});

	it("renders an Error's name and message instead of an empty object", () => {
		expect(coerceErrorText(new Error("boom"))).toBe('{"name":"Error","message":"boom"}');
	});

	it("drops a circular reference instead of falling back to [object Object]", () => {
		const cyclic: Record<string, unknown> = { name: "test" };
		cyclic.self = cyclic;
		expect(coerceErrorText(cyclic)).toBe('{"name":"test"}');
	});

	it("renders a Redacted value as <redacted>, never its secret", () => {
		expect(coerceErrorText({ token: Redacted.make("hunter2") })).toBe('{"token":"<redacted>"}');
	});

	it("returns the placeholder when both JSON and String throw", () => {
		const hostile = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(hostile, "x", {
			enumerable: true,
			get() {
				throw new Error("nope");
			},
		});
		expect(coerceErrorText(hostile)).toBe("<unserializable>");
	});
});
