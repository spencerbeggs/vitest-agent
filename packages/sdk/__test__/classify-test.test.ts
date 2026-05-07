import { describe, expect, it } from "vitest";
import { classifyTest } from "../src/utils/classify-test.js";

describe("classifyTest", () => {
	describe("when current run failed", () => {
		it("should return new-failure when there are no prior runs", () => {
			// Given: a test that has no run history
			const priorRuns: Array<{ state: string }> = [];

			// When: the current run fails
			const result = classifyTest("failed", priorRuns);

			// Then: the classification is new-failure
			expect(result).toBe("new-failure");
		});

		it("should return new-failure when all prior runs passed", () => {
			// Given: a test that has only passing history
			const priorRuns = [{ state: "passed" }, { state: "passed" }, { state: "passed" }];

			// When: the current run fails
			const result = classifyTest("failed", priorRuns);

			// Then: the classification is new-failure (first failure despite prior passes)
			expect(result).toBe("new-failure");
		});

		it("should return persistent when the most recent prior run also failed", () => {
			// Given: a test whose most recent prior run also failed
			const priorRuns = [{ state: "failed" }, { state: "passed" }];

			// When: the current run fails again
			const result = classifyTest("failed", priorRuns);

			// Then: the classification is persistent (consecutive failures)
			expect(result).toBe("persistent");
		});

		it("should return flaky when the most recent prior run passed but an earlier run failed", () => {
			// Given: a test with mixed history where the most recent run passed but earlier ones failed
			const priorRuns = [{ state: "passed" }, { state: "failed" }];

			// When: the current run fails
			const result = classifyTest("failed", priorRuns);

			// Then: the classification is flaky (non-deterministic pass/fail pattern)
			expect(result).toBe("flaky");
		});
	});

	describe("when current run passed", () => {
		it("should return stable when there are no prior runs", () => {
			// Given: a test that has no run history
			const priorRuns: Array<{ state: string }> = [];

			// When: the current run passes
			const result = classifyTest("passed", priorRuns);

			// Then: the classification is stable
			expect(result).toBe("stable");
		});

		it("should return recovered when at least one prior run failed", () => {
			// Given: a test that had a prior failure
			const priorRuns = [{ state: "failed" }, { state: "passed" }];

			// When: the current run passes
			const result = classifyTest("passed", priorRuns);

			// Then: the classification is recovered (was failing, now passing)
			expect(result).toBe("recovered");
		});

		it("should return stable when all prior runs also passed", () => {
			// Given: a test with a consistent passing history
			const priorRuns = [{ state: "passed" }, { state: "passed" }];

			// When: the current run also passes
			const result = classifyTest("passed", priorRuns);

			// Then: the classification is stable (consistently passing)
			expect(result).toBe("stable");
		});
	});
});
