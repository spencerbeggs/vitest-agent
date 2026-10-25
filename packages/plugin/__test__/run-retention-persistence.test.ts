/**
 * Issue 623: the reporter applies the run-retention policy inside its persist
 * transaction, after the run's own rows are written, so `data.db` keeps the
 * newest N runs per project and the run just written is never pruned.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { VitestTestCase, VitestTestModule } from "@vitest-agent/sdk";
import { RunRetentionPolicy } from "@vitest-agent/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

const readCounts = (dbPath: string) => {
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const one = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
		return {
			runs: one("SELECT COUNT(*) AS c FROM test_runs"),
			modules: one("SELECT COUNT(*) AS c FROM test_modules"),
			cases: one("SELECT COUNT(*) AS c FROM test_cases"),
			history: one("SELECT COUNT(*) AS c FROM test_history"),
			historyWithoutRun: one("SELECT COUNT(*) AS c FROM test_history WHERE run_id IS NULL"),
		};
	} finally {
		db.close();
	}
};

/** Persist one run through a fresh reporter instance over `cacheDir`. */
const persistRun = async (cacheDir: string, retention: RunRetentionPolicy | false | undefined) => {
	const reporter = new AgentReporter({
		cacheDir,
		consoleMode: "silent",
		...(retention !== undefined && { retention }),
	});
	await reporter.onTestRunEnd([makeTestModule()], [], "passed");
};

describe("run retention inside the reporter's persist transaction (#623)", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "run-retention-persistence-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("prunes runs beyond keepRuns after writing the current run, keeping history", async () => {
		const policy = RunRetentionPolicy.make({ keepRuns: 1 });
		await persistRun(tmpDir, policy);
		await new Promise((resolve) => setTimeout(resolve, 5)); // distinct run timestamps
		await persistRun(tmpDir, policy);
		await new Promise((resolve) => setTimeout(resolve, 5));
		await persistRun(tmpDir, policy);

		const counts = readCounts(path.join(tmpDir, "data.db"));
		expect(counts.runs).toBe(1);
		expect(counts.modules).toBe(1);
		expect(counts.cases).toBe(1);
		// Three runs of one test: history keeps all three, two now detached from their run.
		expect(counts.history).toBe(3);
		expect(counts.historyWithoutRun).toBe(2);
	});

	it("leaves every run in place when retention is disabled", async () => {
		await persistRun(tmpDir, false);
		await new Promise((resolve) => setTimeout(resolve, 5));
		await persistRun(tmpDir, false);

		const counts = readCounts(path.join(tmpDir, "data.db"));
		expect(counts.runs).toBe(2);
		expect(counts.history).toBe(2);
		expect(counts.historyWithoutRun).toBe(0);
	});

	it("keeps every run under the default policy when no config names a smaller window", async () => {
		await persistRun(tmpDir, undefined);
		await new Promise((resolve) => setTimeout(resolve, 5));
		await persistRun(tmpDir, undefined);

		expect(readCounts(path.join(tmpDir, "data.db")).runs).toBe(2);
	});
});
