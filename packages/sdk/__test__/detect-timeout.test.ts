import { describe, expect, it } from "vitest";
import { isTimeoutError } from "../src/utils/detect-timeout.js";

describe("isTimeoutError", () => {
	it("matches Vitest's test-timeout message", () => {
		expect(isTimeoutError({ message: "Test timed out in 5000ms." })).toBe(true);
	});

	it("matches a hook-timeout message", () => {
		expect(isTimeoutError({ message: "Hook timed out in 10000ms." })).toBe(true);
	});

	it("matches by error name", () => {
		expect(isTimeoutError({ message: "something", name: "TimeoutError" })).toBe(true);
	});

	it("is case-insensitive on the message", () => {
		expect(isTimeoutError({ message: "TEST TIMED OUT IN 5000MS" })).toBe(true);
	});

	it("matches an around-hook setup timeout message", () => {
		expect(
			isTimeoutError({
				message: 'The setup phase of "aroundEach" hook timed out after 5000ms.',
				name: "AroundHookSetupError",
			}),
		).toBe(true);
	});

	it("matches an around-hook teardown timeout message", () => {
		expect(
			isTimeoutError({
				message: 'The teardown phase of "aroundAll" hook timed out after 100ms.',
				name: "AroundHookTeardownError",
			}),
		).toBe(true);
	});

	it("matches the TestTimeoutError and HookTimeoutError names", () => {
		expect(isTimeoutError({ message: "x", name: "TestTimeoutError" })).toBe(true);
		expect(isTimeoutError({ message: "x", name: "HookTimeoutError" })).toBe(true);
	});

	it("does not match an unrelated around-hook error", () => {
		expect(isTimeoutError({ message: "aroundEach hook failed", name: "AroundHookSetupError" })).toBe(false);
	});

	it("does not match an ordinary assertion error", () => {
		expect(isTimeoutError({ message: "expected 1 to be 2", name: "AssertionError" })).toBe(false);
	});

	it("does not match when message is undefined", () => {
		expect(isTimeoutError({})).toBe(false);
	});
});
