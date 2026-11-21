/**
 * Streaming paths that read finalAttemptErrors: TestFinished (error and
 * timedOut), and the module and run timeout tallies. A test that passed
 * on a retry carries no error; a failed repeat test reports the failing attempt.
 *
 * @packageDocumentation
 */

import type { RunEvent } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { AgentReporter } from "../src/reporter.js";

interface Err {
	message: string;
}

const timeoutErr: Err = { message: "Test timed out in 5000ms." };
const assertErr: Err = { message: "expected 1 to be 2" };

const module = { relativeModuleId: "a.test.ts" };

function makeTest(spec: { state: "passed" | "failed"; resultErrors: Err[]; attempts: Array<{ errors: Err[] }> }) {
	return {
		type: "test" as const,
		name: "retried",
		parent: { type: "module" as const, name: "a.test.ts", parent: undefined },
		module,
		tags: [],
		result: () => ({ state: spec.state, errors: spec.resultErrors }),
		attempts: () => spec.attempts,
		diagnostic: () => ({ duration: 1 }),
	};
}

function makeModule(test: ReturnType<typeof makeTest>) {
	return {
		type: "module" as const,
		moduleId: "/abs/a.test.ts",
		relativeModuleId: "a.test.ts",
		project: { name: "default" },
		state: () => test.result().state,
		children: {
			*allTests() {
				yield test;
			},
			*allSuites() {},
		},
		diagnostic: () => ({ duration: 1 }),
		errors: () => [],
	};
}

// Passed on retry: the first attempt timed out, the second passed.
const passedOnRetry = () =>
	makeTest({ state: "passed", resultErrors: [timeoutErr], attempts: [{ errors: [timeoutErr] }, { errors: [] }] });

// Repeats: an early repeat timed out, the final repeat passed; Vitest marks the test failed.
const failedRepeat = () =>
	makeTest({
		state: "failed",
		resultErrors: [timeoutErr],
		attempts: [{ errors: [timeoutErr] }, { errors: [] }],
	});

async function runEnd(reporter: AgentReporter, mod: ReturnType<typeof makeModule>) {
	const originalWrite = process.stderr.write.bind(process.stderr);
	process.stderr.write = (() => true) as typeof process.stderr.write;
	try {
		await reporter.onTestRunEnd([mod] as unknown as ReadonlyArray<unknown>, [], "passed");
	} catch {
		// persistence of a minimal fixture may throw after RunFinished
	} finally {
		process.stderr.write = originalWrite;
	}
}

describe("AgentReporter final attempt errors", () => {
	it("attaches no error to TestFinished for a test that passed on retry", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		reporter.onTestCaseResult(passedOnRetry());
		const finished = events.find((e) => e._tag === "TestFinished") as Record<string, unknown>;
		expect(finished.status).toBe("passed");
		expect(finished.error).toBeUndefined();
		expect(finished.timedOut).toBeFalsy();
	});

	it("reports the failing attempt's error and timedOut on TestFinished when an early repeat failed", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		reporter.onTestCaseResult(failedRepeat());
		expect(events.find((e) => e._tag === "TestFinished")).toMatchObject({
			status: "failed",
			error: { message: timeoutErr.message },
			timedOut: true,
		});
	});

	it("does not count a passed-on-retry test toward the module timeout tally", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		reporter.onTestModuleEnd(makeModule(passedOnRetry()));
		expect(events.find((e) => e._tag === "ModuleFinished")).toMatchObject({
			passCount: 1,
			failCount: 0,
			timeoutCount: 0,
		});
	});

	it("counts a failed repeat test with a timed-out deciding attempt in the module timeout tally", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		reporter.onTestModuleEnd(makeModule(failedRepeat()));
		expect(events.find((e) => e._tag === "ModuleFinished")).toMatchObject({
			passCount: 0,
			failCount: 0,
			timeoutCount: 1,
		});
	});

	it("tallies a failed repeat test's timeout in RunFinished.timeoutCount", async () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		await runEnd(reporter, makeModule(failedRepeat()));
		expect(events.find((e) => e._tag === "RunFinished")).toMatchObject({ failCount: 0, timeoutCount: 1 });
	});

	it("does not tally a passed-on-retry test's earlier timeout in RunFinished", async () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		await runEnd(reporter, makeModule(passedOnRetry()));
		expect(events.find((e) => e._tag === "RunFinished")).toMatchObject({
			passCount: 1,
			failCount: 0,
			timeoutCount: 0,
		});
	});

	it("keeps assertion failures out of the timeout tally when the failing attempt has an assertion error", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		const test = makeTest({
			state: "failed",
			resultErrors: [timeoutErr, assertErr],
			attempts: [{ errors: [timeoutErr] }, { errors: [assertErr] }],
		});
		reporter.onTestModuleEnd(makeModule(test));
		expect(events.find((e) => e._tag === "ModuleFinished")).toMatchObject({ failCount: 1, timeoutCount: 0 });
	});
});
