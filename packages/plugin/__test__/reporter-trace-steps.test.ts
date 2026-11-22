/**
 * Issue 737: Vitest 5.1's `internal:browserTrace` artifact (the
 * `experimental.traceTimeline` steps of a failed attempt) is read by the
 * reporter -- persisted to `test_trace_steps` and attached to the live
 * `TestFinished` error -- while staying out of `test_artifacts`.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RunEvent, VitestTestCase, VitestTestModule } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { AgentReporter, toArtifactInputs } from "../src/reporter.js";

const firstTry = { name: "AssertionError", message: "first try" };
const secondTry = { name: "AssertionError", message: "second try" };

const trace = (retry: number, names: string[]) => ({
	type: "internal:browserTrace",
	data: {
		retry,
		repeats: 0,
		entries: [
			...names.map((name, i) => ({ name, kind: "mark", startTime: i * 10 })),
			{ name: "vitest:onAfterRetryTask", kind: "lifecycle", startTime: 99 },
		],
	},
});

const attempts = [
	{ state: "failed", errors: [firstTry], duration: 5, startTime: 100, retryIndex: 0, repeatIndex: 0 },
	{ state: "failed", errors: [secondTry], duration: 4, startTime: 110, retryIndex: 1, repeatIndex: 0 },
];

function makeTestCase(artifacts: unknown[]) {
	return {
		type: "test",
		name: "traced",
		fullName: "traced",
		tags: [],
		parent: { type: "module", name: "foo.test.ts" },
		module: { relativeModuleId: "src/foo.test.ts" },
		result: () => ({ state: "failed", errors: [firstTry, secondTry] }),
		attempts: () => attempts,
		diagnostic: () => ({ duration: 9, flaky: false, slow: false, retryCount: 1, repeatCount: 0 }),
		annotations: () => [],
		artifacts: () => artifacts,
	} as unknown as VitestTestCase;
}

function makeTestModule(tests: Array<VitestTestCase>): VitestTestModule {
	return {
		type: "module",
		moduleId: "/abs/src/foo.test.ts",
		relativeModuleId: "src/foo.test.ts",
		project: { name: "" },
		state: () => "failed",
		children: {
			*allTests() {
				for (const t of tests) yield t;
			},
			*allSuites() {},
		},
		diagnostic: () => ({ duration: 5 }),
		errors: () => [],
	} as unknown as VitestTestModule;
}

describe("trace timeline artifacts", () => {
	it("persists the failed attempt's steps to test_trace_steps linked to that attempt, and not to test_artifacts", async () => {
		const cacheDir = mkdtempSync(join(tmpdir(), "va-trace-"));
		const reporter = new AgentReporter({ cacheDir });
		const artifacts = [trace(0, ["vitest:early"]), trace(1, ["vitest:setup", "vitest:expect.toBe"])];
		await reporter.onTestRunEnd([makeTestModule([makeTestCase(artifacts)])], [], "failed");

		const db = new DatabaseSync(join(cacheDir, "data.db"), { readOnly: true });
		try {
			const rows = db
				.prepare(
					"SELECT ts.name AS name, ts.ordinal AS ordinal, ta.retry_index AS retry FROM test_trace_steps ts JOIN test_attempts ta ON ta.id = ts.attempt_id ORDER BY ts.ordinal",
				)
				.all();
			expect(rows).toEqual([
				{ name: "setup", ordinal: 0, retry: 1 },
				{ name: "expect.toBe", ordinal: 1, retry: 1 },
			]);
			expect(db.prepare("SELECT COUNT(*) AS n FROM test_artifacts").get()).toEqual({ n: 0 });
		} finally {
			db.close();
			rmSync(cacheDir, { recursive: true, force: true });
		}
	});

	it("still persists the run when a trace artifact is malformed", async () => {
		const cacheDir = mkdtempSync(join(tmpdir(), "va-trace-bad-"));
		const reporter = new AgentReporter({ cacheDir });
		const hostile = {
			type: "internal:browserTrace",
			get data(): unknown {
				throw new Error("boom");
			},
		};
		await reporter.onTestRunEnd(
			[makeTestModule([makeTestCase([hostile, { type: "internal:browserTrace", data: { entries: 3 } }])])],
			[],
			"failed",
		);
		const db = new DatabaseSync(join(cacheDir, "data.db"), { readOnly: true });
		try {
			expect(db.prepare("SELECT COUNT(*) AS n FROM test_cases").get()).toEqual({ n: 1 });
			expect(db.prepare("SELECT COUNT(*) AS n FROM test_trace_steps").get()).toEqual({ n: 0 });
		} finally {
			db.close();
			rmSync(cacheDir, { recursive: true, force: true });
		}
	});

	it("attaches the failed attempt's steps to the TestFinished error", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		reporter.onTestCaseResult(makeTestCase([trace(1, ["vitest:expect.toBe"])]) as never);
		const finished = events.find((e) => e._tag === "TestFinished") as { error?: { traceSteps?: unknown } };
		expect(finished.error?.traceSteps).toEqual([{ name: "expect.toBe", startTime: 0, depth: 0 }]);
	});

	it("keeps internal artifacts out of the test_artifacts inputs", () => {
		expect(toArtifactInputs(1, [trace(0, ["vitest:a"])] as never)).toEqual([]);
	});
});
