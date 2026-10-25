/**
 * Issue #622: on a multi-project run the one aggregating `AgentReporter`
 * analyzes the single global coverage map once, and must persist its
 * `file_coverage` rows ONCE per invocation — not once per project. Before
 * this change a workspace of 40 projects wrote 40 identical copies of every
 * row (88 files x 40 projects = 3,520 rows per run on spencerbeggs/effected).
 * The per-project `coverage_trends` row is kept so every project still has
 * its own trend series.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { VitestTestCase, VitestTestModule } from "@vitest-agent/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentReporter } from "../src/reporter.js";

const FILES = ["/abs/src/a.ts", "/abs/src/b.ts", "/abs/src/c.ts"];

function mockCoverageMap() {
	return {
		getCoverageSummary: () => ({
			statements: { pct: 50 },
			branches: { pct: 50 },
			functions: { pct: 50 },
			lines: { pct: 50 },
		}),
		files: () => FILES,
		fileCoverageFor: () => ({
			toSummary: () => ({
				statements: { pct: 50 },
				branches: { pct: 50 },
				functions: { pct: 50 },
				lines: { pct: 50 },
			}),
			getUncoveredLines: () => [1, 2],
		}),
	};
}

function makeTestModule(projectName: string): VitestTestModule {
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
		moduleId: `/abs/${projectName}/foo.test.ts`,
		relativeModuleId: `${projectName}/foo.test.ts`,
		project: { name: projectName },
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

describe("coverage rows are written once per invocation (#622)", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coverage-once-per-invocation-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("writes one file_coverage row per file, not per file x project, and one trend row per project", async () => {
		const reporter = new AgentReporter({
			cacheDir: tmpDir,
			consoleMode: "silent",
			coverageMode: "full",
			coverageThresholds: {
				global: { lines: 100, functions: 100, branches: 100, statements: 100 },
				perFile: false,
				patterns: [],
			},
		});

		const projects = ["alpha", "beta", "gamma"];
		reporter.onCoverage(mockCoverageMap());
		await reporter.onTestRunEnd(
			projects.map((p) => makeTestModule(p)),
			[],
			"passed",
		);

		const db = new DatabaseSync(path.join(tmpDir, "data.db"), { readOnly: true });
		try {
			const runs = db.prepare("SELECT id, project, invocation_id FROM test_runs ORDER BY id").all() as Array<{
				id: number;
				project: string;
				invocation_id: string;
			}>;
			expect(runs.map((r) => r.project)).toEqual(projects);
			expect(new Set(runs.map((r) => r.invocation_id)).size).toBe(1);

			const fileRows = db.prepare("SELECT run_id FROM file_coverage").all() as Array<{ run_id: number }>;
			// One row per file in the map — never files x projects.
			expect(fileRows).toHaveLength(FILES.length);
			// All under ONE run: the first project group's run.
			expect(new Set(fileRows.map((r) => r.run_id))).toEqual(new Set([runs[0].id]));

			const trendRows = db.prepare("SELECT project FROM coverage_trends ORDER BY project").all() as Array<{
				project: string;
			}>;
			expect(trendRows.map((r) => r.project)).toEqual([...projects].sort());
		} finally {
			db.close();
		}
	});
});
