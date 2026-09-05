/**
 * Pure decision-function tests for coverage.reportsDirectory isolation
 * (issue #194 remaining scope: plain-CLI concurrent-run clobbering).
 */

import { describe, expect, it } from "vitest";
import { resolveCoverageDirIsolation } from "../src/utils/resolve-coverage-dir-isolation.js";

describe("resolveCoverageDirIsolation", () => {
	it("isolates for the agent executor with coverage enabled and no overrides", () => {
		const result = resolveCoverageDirIsolation({
			executor: "agent",
			coverageEnabled: true,
			env: {},
			configured: "coverage",
		});
		expect(result).toEqual({ kind: "isolate" });
	});

	it("keeps the configured directory for the human executor", () => {
		const result = resolveCoverageDirIsolation({
			executor: "human",
			coverageEnabled: true,
			env: {},
			configured: "coverage",
		});
		expect(result).toEqual({ kind: "keep" });
	});

	it("keeps the configured directory for the ci executor", () => {
		const result = resolveCoverageDirIsolation({
			executor: "ci",
			coverageEnabled: true,
			env: {},
			configured: "coverage",
		});
		expect(result).toEqual({ kind: "keep" });
	});

	it("keeps the configured directory when coverage is disabled, even for the agent executor", () => {
		const result = resolveCoverageDirIsolation({
			executor: "agent",
			coverageEnabled: false,
			env: {},
			configured: "coverage",
		});
		expect(result).toEqual({ kind: "keep" });
	});

	for (const off of ["off", "0", "false"]) {
		it(`respects the opt-out VITEST_AGENT_COVERAGE_DIR_ISOLATION=${off}`, () => {
			const result = resolveCoverageDirIsolation({
				executor: "agent",
				coverageEnabled: true,
				env: { VITEST_AGENT_COVERAGE_DIR_ISOLATION: off },
				configured: "coverage",
			});
			expect(result).toEqual({ kind: "keep" });
		});
	}

	it("uses an explicit VITEST_AGENT_COVERAGE_DIR verbatim, taking precedence over isolation", () => {
		const result = resolveCoverageDirIsolation({
			executor: "agent",
			coverageEnabled: true,
			env: { VITEST_AGENT_COVERAGE_DIR: "/tmp/my-cov-dir" },
			configured: "coverage",
		});
		expect(result).toEqual({ kind: "explicit", dir: "/tmp/my-cov-dir" });
	});

	it("prefers the opt-out over an explicit dir when both are set", () => {
		const result = resolveCoverageDirIsolation({
			executor: "agent",
			coverageEnabled: true,
			env: { VITEST_AGENT_COVERAGE_DIR_ISOLATION: "off", VITEST_AGENT_COVERAGE_DIR: "/tmp/my-cov-dir" },
			configured: "coverage",
		});
		expect(result).toEqual({ kind: "keep" });
	});
});
