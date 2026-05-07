import { describe, expect, it } from "vitest";
import { captureEnvVars } from "../src/utils/capture-env.js";

describe("captureEnvVars", () => {
	it("always captures CI, NODE_ENV, VITEST_MODE", () => {
		const env = { CI: "true", NODE_ENV: "test", VITEST_MODE: "run", OTHER: "ignore" };
		const result = captureEnvVars(env);
		expect(result).toEqual({
			CI: "true",
			NODE_ENV: "test",
			VITEST_MODE: "run",
		});
	});

	it("captures GITHUB_* and RUNNER_* when GITHUB_ACTIONS is set", () => {
		const env = {
			GITHUB_ACTIONS: "true",
			GITHUB_RUN_ID: "123",
			GITHUB_SHA: "abc",
			RUNNER_OS: "Linux",
			OTHER: "ignore",
		};
		const result = captureEnvVars(env);
		expect(result.GITHUB_ACTIONS).toBe("true");
		expect(result.GITHUB_RUN_ID).toBe("123");
		expect(result.GITHUB_SHA).toBe("abc");
		expect(result.RUNNER_OS).toBe("Linux");
		expect(result.OTHER).toBeUndefined();
	});

	it("omits undefined vars", () => {
		const result = captureEnvVars({});
		expect(Object.keys(result).length).toBe(0);
	});
});
