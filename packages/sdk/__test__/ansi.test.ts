import { describe, expect, it } from "vitest";
import { stripAnsi } from "../src/utils/ansi.js";

describe("stripAnsi", () => {
	it("removes ANSI escape codes from text", () => {
		expect(stripAnsi("\x1b[31mhello\x1b[39m")).toBe("hello");
	});

	it("passes through plain text unchanged", () => {
		expect(stripAnsi("plain text")).toBe("plain text");
	});
});
