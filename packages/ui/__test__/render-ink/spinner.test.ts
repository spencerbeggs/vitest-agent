import { Glyphs } from "@effected/cli";
import { describe, expect, it } from "vitest";
import { SPINNER_FRAMES, SPINNER_FRAME_MS, spinnerFrame, spinnerFrameForTime } from "../../src/render-ink/spinner.js";

describe("spinnerFrame", () => {
	it("returns the first frame for index 0", () => {
		expect(spinnerFrame(0)).toBe(SPINNER_FRAMES[0]);
	});

	it("wraps modulo the frame count", () => {
		expect(spinnerFrame(SPINNER_FRAMES.length)).toBe(SPINNER_FRAMES[0]);
		expect(spinnerFrame(SPINNER_FRAMES.length + 3)).toBe(SPINNER_FRAMES[3]);
	});

	it("tolerates a negative index", () => {
		expect(spinnerFrame(-1)).toBe(SPINNER_FRAMES[SPINNER_FRAMES.length - 1]);
	});

	it("truncates a fractional index", () => {
		expect(spinnerFrame(2.9)).toBe(SPINNER_FRAMES[2]);
	});
});

describe("spinnerFrameForTime", () => {
	it("advances one index per frame interval", () => {
		const base = spinnerFrameForTime(0);
		expect(spinnerFrameForTime(SPINNER_FRAME_MS)).toBe(base + 1);
		expect(spinnerFrameForTime(SPINNER_FRAME_MS * 5)).toBe(base + 5);
	});

	it("holds the same index within a single frame interval", () => {
		const intervalStart = SPINNER_FRAME_MS * 12;
		expect(spinnerFrameForTime(intervalStart)).toBe(spinnerFrameForTime(intervalStart + SPINNER_FRAME_MS - 1));
	});
});

describe("spinner — kit glyph sets", () => {
	it("draws the kit's Unicode Braille frames at 80ms by default", () => {
		expect(SPINNER_FRAMES).toEqual(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]);
		expect(SPINNER_FRAME_MS).toBe(80);
	});

	it("draws the ASCII frames from an ASCII glyph set", () => {
		const ascii = Glyphs.select({ ascii: true });
		expect(spinnerFrame(0, ascii)).toBe(ascii.spinner[0]);
		expect(spinnerFrame(ascii.spinner.length + 1, ascii)).toBe(ascii.spinner[1]);
		expect(SPINNER_FRAMES).not.toContain(spinnerFrame(0, ascii));
	});
});
