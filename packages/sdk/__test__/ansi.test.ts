import { describe, expect, it } from "vitest";
import { ansi, stripAnsi } from "../src/utils/ansi.js";

describe("ansi", () => {
	it("wraps text with ANSI codes when noColor is false", () => {
		const result = ansi("hello", "red", { noColor: false });
		expect(result).toContain("\x1b[");
		expect(result).toContain("hello");
	});

	it("returns plain text when noColor is true", () => {
		const result = ansi("hello", "red", { noColor: true });
		expect(result).toBe("hello");
	});

	it("wraps text when no options provided (defaults to color on)", () => {
		const result = ansi("hello", "bold");
		expect(result).toContain("\x1b[");
		expect(result).toContain("hello");
	});

	it("returns plain text for unknown color name", () => {
		const result = ansi("hello", "nonexistent");
		expect(result).toBe("hello");
	});
});

describe("stripAnsi", () => {
	it("removes ANSI escape codes from text", () => {
		const colored = ansi("hello", "red", { noColor: false });
		expect(stripAnsi(colored)).toBe("hello");
	});

	it("passes through plain text unchanged", () => {
		expect(stripAnsi("plain text")).toBe("plain text");
	});
});
