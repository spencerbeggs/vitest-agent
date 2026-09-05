/**
 * Issue #194 remaining scope — "make the silent-failure mode loud". A
 * coverage-provider throw during report generation (the clobber symptom of
 * two runs sharing `coverage.reportsDirectory`) must surface as an
 * `unhandledErrors` entry on the rendered report rather than a silent
 * exit-0. Vitest already routes an unhandled run error through
 * `onTestRunEnd`'s `unhandledErrors` parameter, and `AgentReporter` already
 * threads that parameter into every rendered `AgentReport` (issue #240) —
 * this test proves the existing plumbing covers the coverage-clobber case
 * too, so no additional wiring is needed.
 */

import type { VitestTestCase, VitestTestModule } from "@vitest-agent/sdk";
import { describe, expect, it, vi } from "vitest";
import { AgentReporter } from "../src/reporter.js";

function makeTestModule(): VitestTestModule {
	const test: VitestTestCase = {
		type: "test",
		name: "a test",
		fullName: "a test",
		tags: [],
		result: () => ({ state: "passed" }),
		diagnostic: () => ({ duration: 10, flaky: false, slow: false }),
	};
	return {
		type: "module",
		moduleId: "/abs/src/foo.test.ts",
		relativeModuleId: "src/foo.test.ts",
		project: { name: "" },
		state: () => "passed",
		children: {
			*allTests() {
				yield test;
			},
			*allSuites() {},
		},
		diagnostic: () => ({ duration: 50 }),
		errors: () => [],
	};
}

describe("unhandledErrors surface on the rendered report instead of a silent exit-0 (#194)", () => {
	it("threads a coverage-provider-flavored unhandled error into the UI-only rendered report", async () => {
		const render = vi.fn(() => []);
		const reporter = new AgentReporter({
			consoleMode: "silent",
			coverageMode: "ui-only",
			reporter: () => ({ render }),
		});
		reporter.onTestRunStart([]);

		const coverageClobberError = {
			message: "ENOENT: no such file or directory, open 'coverage/.tmp/coverage-1.json'",
			stack: "Error: ENOENT ... at V8CoverageProvider.reportCoverage",
		};

		await reporter.onTestRunEnd([makeTestModule()], [coverageClobberError], "passed");

		expect(render).toHaveBeenCalledOnce();
		const [renderInput] = render.mock.calls[0] as [{ reports: Array<{ unhandledErrors: Array<{ message: string }> }> }];
		const allUnhandled = renderInput.reports.flatMap((r) => r.unhandledErrors);
		expect(allUnhandled.length).toBeGreaterThanOrEqual(1);
		expect(allUnhandled.some((e) => e.message.includes("ENOENT"))).toBe(true);
	});
});
