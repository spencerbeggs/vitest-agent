/**
 * The fixed fallback of `safeFormatFatalError` (issue #243): the engine
 * formatter is total, so the only way to reach the fallback is a formatter
 * that throws or returns a non-string. Both are forced here by mocking it.
 */

import { describe, expect, it, vi } from "vitest";
import { UNFORMATTABLE_ERROR_TEXT, safeFormatFatalError } from "../src/utils/safe-format-fatal-error.js";

const formatter = vi.hoisted(() => ({ impl: (_err: unknown): unknown => "" }));

vi.mock("@vitest-agent/engine", async (importOriginal) => ({
	...(await importOriginal<typeof import("@vitest-agent/engine")>()),
	formatFatalError: (err: unknown) => formatter.impl(err),
}));

describe("safeFormatFatalError — fallback", () => {
	it("returns the fixed fallback when the formatter throws", () => {
		formatter.impl = () => {
			throw new Error("formatter detonated");
		};

		expect(safeFormatFatalError(new Error("x"))).toBe(UNFORMATTABLE_ERROR_TEXT);
	});

	it("returns the fixed fallback when the formatter returns a non-string", () => {
		formatter.impl = () => undefined;

		expect(safeFormatFatalError(new Error("x"))).toBe(UNFORMATTABLE_ERROR_TEXT);
	});

	it("passes a string from the formatter through", () => {
		formatter.impl = () => "formatted";

		expect(safeFormatFatalError(new Error("x"))).toBe("formatted");
	});
});
