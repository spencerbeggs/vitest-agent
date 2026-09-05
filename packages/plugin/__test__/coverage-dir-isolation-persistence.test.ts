/**
 * Issue #194 remaining scope: proves that isolating
 * `coverage.reportsDirectory` to a per-process temp directory does not
 * break `file_coverage` persistence. `AgentReporter` reads coverage from
 * the in-memory istanbul `CoverageMap` handed to `onCoverage` — never from
 * disk — so relocating the reports directory must be a no-op for
 * persistence.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { VitestTestCase, VitestTestModule } from "@vitest-agent/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentReporter } from "../src/reporter.js";

function mockCoverageMap() {
	const files: Record<
		string,
		{ summary: { statements: number; branches: number; functions: number; lines: number }; uncoveredLines: number[] }
	> = {
		"/abs/src/foo.ts": {
			summary: { statements: 90, branches: 85, functions: 88, lines: 91 },
			uncoveredLines: [3, 4],
		},
	};
	return {
		getCoverageSummary: () => ({
			statements: { pct: 90 },
			branches: { pct: 85 },
			functions: { pct: 88 },
			lines: { pct: 91 },
		}),
		files: () => Object.keys(files),
		fileCoverageFor: (p: string) => ({
			toSummary: () => {
				const s = files[p].summary;
				return {
					statements: { pct: s.statements },
					branches: { pct: s.branches },
					functions: { pct: s.functions },
					lines: { pct: s.lines },
				};
			},
			getUncoveredLines: () => files[p].uncoveredLines,
		}),
	};
}

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

describe("file_coverage persistence survives coverage.reportsDirectory isolation (#194)", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coverage-dir-isolation-persistence-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("writes file_coverage rows even when reportsDirectory was rewritten to an isolated temp dir", async () => {
		// Given: an isolated coverage reports dir that is NOT the reporter's
		// cacheDir — proving persistence never touches it.
		const isolatedReportsDir = fs.mkdtempSync(path.join(os.tmpdir(), "vitest-agent-cov-"));

		const reporter = new AgentReporter({
			cacheDir: tmpDir,
			consoleMode: "silent",
			coverageMode: "full",
			// Thresholds above the mock file's stats (90/85/88/91) so the file
			// is flagged "below_threshold" and lands in the persisted tier —
			// only below-threshold / below-target files get a file_coverage row.
			coverageThresholds: {
				global: { lines: 100, functions: 100, branches: 100, statements: 100 },
				perFile: false,
				patterns: [],
			},
		});

		// When: coverage is stashed (as Vitest's onCoverage would) and the run ends
		reporter.onCoverage(mockCoverageMap());
		await reporter.onTestRunEnd([makeTestModule()], [], "passed");

		fs.rmSync(isolatedReportsDir, { recursive: true, force: true });

		// Then: file_coverage carries at least one row, keyed off the in-memory
		// map — never off `isolatedReportsDir`, which was deleted above.
		const db = new DatabaseSync(path.join(tmpDir, "data.db"), { readOnly: true });
		const rows = db.prepare("SELECT COUNT(*) AS cnt FROM file_coverage").all() as Array<{ cnt: number }>;
		db.close();
		expect(rows[0].cnt).toBeGreaterThanOrEqual(1);
	});
});
