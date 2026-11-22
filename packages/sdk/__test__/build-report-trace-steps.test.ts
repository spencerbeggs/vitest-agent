import { describe, expect, it } from "vitest";
import type { VitestTestCase, VitestTestModule } from "../src/utils/build-report.js";
import { buildAgentReport } from "../src/utils/build-report.js";

const trace = (retry: number, names: string[]) => ({
	type: "internal:browserTrace",
	data: { retry, repeats: 0, entries: names.map((name, i) => ({ name, kind: "mark", startTime: i })) },
});

const makeModule = (state: string, artifacts: unknown[]): VitestTestModule => {
	const test = {
		type: "test",
		name: "t",
		fullName: "t",
		tags: [],
		result: () => ({ state, errors: [{ message: "e1" }, { message: "e2" }] }),
		attempts: () => [
			{ errors: [{ message: "e1" }], retryIndex: 0, repeatIndex: 0 },
			{ errors: [{ message: "e1" }, { message: "e2" }], retryIndex: 1, repeatIndex: 0 },
		],
		artifacts: () => artifacts,
		diagnostic: () => ({ duration: 1, flaky: false, slow: false }),
	} as unknown as VitestTestCase;
	return {
		type: "module",
		moduleId: "/abs/a.test.ts",
		relativeModuleId: "a.test.ts",
		project: { name: "p" },
		state: () => state,
		children: {
			*allTests() {
				yield test;
			},
			*allSuites() {},
		},
		diagnostic: () => ({ duration: 1 }),
		errors: () => [],
	} as unknown as VitestTestModule;
};

describe("buildAgentReport trace steps", () => {
	it("should attach the deciding attempt steps to the first error of a failed test only", () => {
		const report = buildAgentReport(
			[makeModule("failed", [trace(0, ["vitest:early"]), trace(1, ["vitest:expect.toBe"])])],
			[],
			"failed",
			{},
		);
		const errors = report.failed[0]?.tests[0]?.errors;
		expect(errors?.[0]?.traceSteps).toEqual([{ name: "expect.toBe", startTime: 0, depth: 0 }]);
		expect(errors?.[1]?.traceSteps).toBeUndefined();
	});

	it("should add no traceSteps when there is no usable trace artifact", () => {
		const report = buildAgentReport(
			[makeModule("failed", [{ type: "internal:browserTrace", data: null }])],
			[],
			"failed",
			{},
		);
		expect(report.failed[0]?.tests[0]?.errors?.[0]).toEqual({ message: "e1" });
	});
});
