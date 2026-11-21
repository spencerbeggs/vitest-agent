import { describe, expect, it } from "vitest";
import { CAPTURED_CI_KEYS, captureEnvVars } from "../src/utils/capture-env.js";

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

	it("captures the GitHub Actions run coordinates under their variable names", () => {
		const env = {
			GITHUB_ACTIONS: "true",
			GITHUB_RUN_ID: "123",
			GITHUB_RUN_ATTEMPT: "2",
			GITHUB_JOB: "test",
			GITHUB_SHA: "abc",
			GITHUB_REF_NAME: "main",
			RUNNER_OS: "Linux",
			RUNNER_ARCH: "X64",
			OTHER: "ignore",
		};
		expect(captureEnvVars(env)).toEqual({
			GITHUB_ACTIONS: "true",
			GITHUB_RUN_ID: "123",
			GITHUB_RUN_ATTEMPT: "2",
			GITHUB_JOB: "test",
			GITHUB_SHA: "abc",
			GITHUB_REF_NAME: "main",
			RUNNER_OS: "Linux",
			RUNNER_ARCH: "X64",
		});
	});

	it("never captures a GITHUB_* or RUNNER_* variable outside the fixed list", () => {
		// A workflow can export a secret into the environment; these values are
		// persisted to data.db and served by the MCP configure tool.
		const env = {
			GITHUB_ACTIONS: "true",
			GITHUB_SHA: "abc",
			GITHUB_TOKEN: "ghs_secret",
			GITHUB_DEPLOY_KEY: "secret",
			RUNNER_TEMP: "/tmp/runner",
			ACTIONS_RUNTIME_TOKEN: "secret",
		};
		const result = captureEnvVars(env);
		expect(result).toEqual({ GITHUB_ACTIONS: "true", GITHUB_SHA: "abc" });
		for (const key of Object.keys(result)) {
			expect(CAPTURED_CI_KEYS as ReadonlyArray<string>).toContain(key);
		}
	});

	it("captures no GitHub variable outside GitHub Actions", () => {
		const result = captureEnvVars({ GITHUB_SHA: "abc", RUNNER_OS: "Linux" });
		expect(result).toEqual({});
	});

	it("omits undefined vars", () => {
		const result = captureEnvVars({});
		expect(Object.keys(result).length).toBe(0);
	});
});
