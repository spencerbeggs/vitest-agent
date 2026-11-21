import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { VitestTestCase, VitestTestModule } from "@vitest-agent/sdk";
import { buildAgentReport } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { AgentReporter } from "../src/reporter.js";

interface Attempt {
	state: "failed" | "passed";
	errors?: Array<{
		message: string;
		name?: string;
		stacks?: Array<{ method: string; file: string; line: number; column: number }>;
	}>;
}

const stacks = [{ method: "fn", file: "/abs/src/foo.test.ts", line: 3, column: 1 }];
const boom = (message: string) => ({ message, name: "Error", stacks });

function makeTestCase(
	name: string,
	state: "failed" | "passed",
	attempts: Attempt[],
	diag: { retryCount?: number; repeatCount?: number } = {},
	resultErrors?: Attempt["errors"],
): VitestTestCase {
	return {
		type: "test",
		name,
		fullName: name,
		tags: [],
		result: () => ({ state, ...(resultErrors ? { errors: resultErrors } : {}) }),
		attempts: () => attempts,
		diagnostic: () => ({ duration: 1, flaky: false, slow: false, ...diag }),
		annotations: () => [],
		artifacts: () => [],
	} as unknown as VitestTestCase;
}

function makeTestModule(tests: VitestTestCase[]): VitestTestModule {
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

async function withDb<T>(tests: VitestTestCase[], read: (db: DatabaseSync) => T): Promise<T> {
	const cacheDir = mkdtempSync(join(tmpdir(), "va-retry-"));
	const reporter = new AgentReporter({ cacheDir });
	await reporter.onTestRunEnd([makeTestModule(tests)], [], "failed");
	const db = new DatabaseSync(join(cacheDir, "data.db"), { readOnly: true });
	try {
		return read(db);
	} finally {
		db.close();
		rmSync(cacheDir, { recursive: true, force: true });
	}
}

describe("retry and repeat bookkeeping", () => {
	it("should persist retryCount and repeatCount on test_cases and retry_count on test_history", async () => {
		const tc = makeTestCase("retried", "passed", [{ state: "passed" }], { retryCount: 2, repeatCount: 1 });
		const failing = makeTestCase("fails", "failed", [{ state: "failed", errors: [boom("x")] }], { retryCount: 1 }, [
			boom("x"),
		]);
		const rows = await withDb([tc, failing], (db) => ({
			cases: db.prepare("SELECT name, retry_count AS r, repeat_count AS p FROM test_cases ORDER BY name").all(),
			history: db.prepare("SELECT full_name AS n, retry_count AS r FROM test_history ORDER BY full_name").all(),
		}));
		expect(rows.cases).toEqual([
			{ name: "fails", r: 1, p: 0 },
			{ name: "retried", r: 2, p: 1 },
		]);
		expect(rows.history).toEqual([
			{ n: "fails", r: 1 },
			{ n: "retried", r: 2 },
		]);
	});

	it("should count a failure signature once per test, not once per retry attempt", async () => {
		const e = boom("same failure");
		const tc = makeTestCase(
			"always fails",
			"failed",
			[
				{ state: "failed", errors: [e] },
				{ state: "failed", errors: [e] },
				{ state: "failed", errors: [e] },
			],
			{ retryCount: 2 },
			[e, e, e],
		);
		const rows = await withDb([tc], (db) => ({
			sigs: db.prepare("SELECT occurrence_count AS c FROM failure_signatures").all(),
			errs: db.prepare("SELECT COUNT(*) AS n FROM test_errors").get(),
		}));
		expect(rows.sigs).toEqual([{ c: 1 }]);
		expect(rows.errs).toEqual({ n: 3 });
	});

	it("should not count signatures for a test that finally passed", async () => {
		const tc = makeTestCase(
			"flaky",
			"passed",
			[{ state: "failed", errors: [boom("first try")] }, { state: "passed" }],
			{ retryCount: 1 },
			[boom("first try")],
		);
		const rows = await withDb([tc], (db) => ({
			sigs: db.prepare("SELECT COUNT(*) AS n FROM failure_signatures").get(),
			errs: db.prepare("SELECT COUNT(*) AS n FROM test_errors").get(),
		}));
		expect(rows.sigs).toEqual({ n: 0 });
		expect(rows.errs).toEqual({ n: 1 });
	});

	it("should store the final attempt's error as the history error_message", async () => {
		const tc = makeTestCase(
			"changes",
			"failed",
			[
				{ state: "failed", errors: [boom("first attempt")] },
				{ state: "failed", errors: [boom("last attempt")] },
			],
			{ retryCount: 1 },
			[boom("first attempt"), boom("last attempt")],
		);
		const rows = await withDb([tc], (db) => db.prepare("SELECT error_message AS m FROM test_history").all());
		expect(rows).toEqual([{ m: "last attempt" }]);
	});
});

describe("final attempt errors in the agent report", () => {
	it("should report the final attempt's errors for a failed retried test", () => {
		const tc = makeTestCase(
			"retried",
			"failed",
			[
				{ state: "failed", errors: [boom("first attempt")] },
				{ state: "failed", errors: [boom("last attempt")] },
			],
			{ retryCount: 1 },
			[boom("first attempt"), boom("last attempt")],
		);
		const report = buildAgentReport([makeTestModule([tc])], [], "failed", {});
		expect(report.failed[0]?.tests[0]?.errors?.map((e) => e.message)).toEqual(["last attempt"]);
	});

	it("should fall back to the result errors when attempts() is empty", () => {
		const tc = makeTestCase("no attempts", "failed", [], {}, [boom("first"), boom("last")]);
		const report = buildAgentReport([makeTestModule([tc])], [], "failed", {});
		expect(report.failed[0]?.tests[0]?.errors?.map((e) => e.message)).toEqual(["first", "last"]);
	});
});
