/**
 * Issue 735: `onTestRunEnd` persists `TestCase.attempts()` as `test_attempts`
 * rows and links each error to the attempt that raised it.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { VitestTestCase, VitestTestModule } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { AgentReporter } from "../src/reporter.js";

const firstTry = { name: "AssertionError", message: "first try" };
const secondTry = { name: "AssertionError", message: "second try" };

function makeTestCase(name: string, attempts: Array<Record<string, unknown>> | undefined, errors: unknown[]) {
	return {
		type: "test",
		name,
		fullName: name,
		tags: [],
		result: () => ({ state: "passed", errors }),
		...(attempts !== undefined && { attempts: () => attempts }),
		diagnostic: () => ({ duration: 9, flaky: true, slow: false, retryCount: 1, repeatCount: 0 }),
		annotations: () => [],
		artifacts: () => [],
	} as unknown as VitestTestCase;
}

function makeTestModule(tests: Array<VitestTestCase>): VitestTestModule {
	return {
		type: "module",
		moduleId: "/abs/src/foo.test.ts",
		relativeModuleId: "src/foo.test.ts",
		project: { name: "" },
		state: () => "passed",
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

describe("onTestRunEnd attempt ingestion", () => {
	it("persists one test_attempts row per attempt and links each error to its attempt", async () => {
		const cacheDir = mkdtempSync(join(tmpdir(), "va-attempts-"));
		const reporter = new AgentReporter({ cacheDir });
		const attempts = [
			{ state: "failed", errors: [firstTry], duration: 5, startTime: 100, retryIndex: 0, repeatIndex: 0 },
			{ state: "failed", errors: [secondTry], duration: 4, startTime: 110, retryIndex: 1, repeatIndex: 0 },
			{ state: "passed", errors: undefined, duration: 3, startTime: 120, retryIndex: 2, repeatIndex: 0 },
		];
		const modules = [
			makeTestModule([
				makeTestCase("flaky", attempts, [firstTry, secondTry]),
				// A Vitest older than 5.1 has no attempts(): nothing to persist.
				makeTestCase("legacy", undefined, []),
			]),
		];
		await reporter.onTestRunEnd(modules, [], "passed");

		const db = new DatabaseSync(join(cacheDir, "data.db"), { readOnly: true });
		try {
			const rows = db
				.prepare(
					"SELECT tc.name AS name, ta.retry_index AS retry, ta.repeat_index AS repeat, ta.state AS state, ta.duration AS duration, ta.start_time AS startTime FROM test_attempts ta JOIN test_cases tc ON tc.id = ta.test_case_id ORDER BY ta.id",
				)
				.all();
			expect(rows).toEqual([
				{ name: "flaky", retry: 0, repeat: 0, state: "failed", duration: 5, startTime: 100 },
				{ name: "flaky", retry: 1, repeat: 0, state: "failed", duration: 4, startTime: 110 },
				{ name: "flaky", retry: 2, repeat: 0, state: "passed", duration: 3, startTime: 120 },
			]);

			const linked = db
				.prepare(
					"SELECT te.message AS message, ta.retry_index AS retry FROM test_errors te JOIN test_attempts ta ON ta.id = te.attempt_id ORDER BY te.id",
				)
				.all();
			expect(linked).toEqual([
				{ message: "first try", retry: 0 },
				{ message: "second try", retry: 1 },
			]);
		} finally {
			db.close();
			rmSync(cacheDir, { recursive: true, force: true });
		}
	});
});
