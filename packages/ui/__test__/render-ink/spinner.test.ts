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
