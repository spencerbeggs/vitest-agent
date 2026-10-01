import { describe, expect, it } from "vitest";
import { formatDisplayDuration } from "../src/format-duration.js";

describe("formatDisplayDuration", () => {
	it("renders a whole sub-second millisecond value unchanged", () => {
		expect(formatDisplayDuration(250)).toBe("250ms");
	});

	it("rounds a sub-second float to whole milliseconds", () => {
		expect(formatDisplayDuration(14.87745800000016)).toBe("15ms");
	});

	it("drops a trailing .0 when the rounded millisecond value is whole", () => {
		expect(formatDisplayDuration(14.02)).toBe("14ms");
	});

	it("renders zero as 0ms", () => {
		expect(formatDisplayDuration(0)).toBe("0ms");
	});

	it("renders exactly one second as 1s", () => {
		expect(formatDisplayDuration(1000)).toBe("1s");
	});

	it("rounds a multi-second value to one decimal place", () => {
		expect(formatDisplayDuration(2549)).toBe("2.5s");
	});

	it("switches to minutes and whole seconds from one minute", () => {
		expect(formatDisplayDuration(63210)).toBe("1m 3s");
	});

	it("stays in the millisecond form just below one second", () => {
		expect(formatDisplayDuration(999.4)).toBe("999ms");
	});

	it("writes a value that rounds up to a second in seconds, never 1000ms", () => {
		expect(formatDisplayDuration(999.6)).toBe("1s");
	});
});
