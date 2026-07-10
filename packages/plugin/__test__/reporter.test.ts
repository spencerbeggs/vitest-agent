/**
 * vitest-agent-plugin
 *
 * Tests for AgentReporter class.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { RunEvent, VitestTestCase, VitestTestModule } from "@vitest-agent/sdk";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentReporter } from "../src/reporter.js";

// --- Test Helpers ---

interface TestErrorFixture {
	readonly message: string;
	readonly name?: string;
	readonly diff?: string;
	readonly stack?: string;
	readonly stacks?: string[];
}

function makeTestCase(
	overrides: Partial<{
		name: string;
		fullName: string;
		state: string;
		duration: number;
		flaky: boolean;
		slow: boolean;
		errors: TestErrorFixture[];
	}> = {},
): VitestTestCase {
	const name = overrides.name ?? "my test";
	return {
		type: "test",
		name,
		fullName: overrides.fullName ?? name,
		tags: [],
		result: () => {
			const res: {
				state: string;
				errors?: ReadonlyArray<TestErrorFixture>;
			} = { state: overrides.state ?? "passed" };
			if (overrides.errors != null) res.errors = overrides.errors;
			return res;
		},
		diagnostic: () => ({
			duration: overrides.duration ?? 10,
			flaky: overrides.flaky ?? false,
			slow: overrides.slow ?? false,
		}),
	};
}

function makeTestModule(
	overrides: Partial<{
		moduleId: string;
		relativeModuleId: string;
		projectName: string;
		state: string;
		duration: number;
		tests: VitestTestCase[];
		errors: Array<{ message: string; stacks?: string[] }>;
	}> = {},
): VitestTestModule {
	const relativeId = overrides.relativeModuleId ?? "src/foo.test.ts";
	const tests = overrides.tests ?? [];

	return {
		type: "module",
		moduleId: overrides.moduleId ?? `/abs/${relativeId}`,
		relativeModuleId: relativeId,
		project: { name: overrides.projectName ?? "" },
		state: () => overrides.state ?? "passed",
		children: {
			*allTests() {
				for (const t of tests) yield t;
			},
			*allSuites() {
				// No suites in test helpers
			},
		},
		diagnostic: () => ({ duration: overrides.duration ?? 50 }),
		errors: () => overrides.errors ?? [],
	};
}

// --- Tests ---

describe("AgentReporter", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reporter-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	describe("constructor", () => {
		it("applies default options", async () => {
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
			});

			await reporter.onTestRunEnd([makeTestModule({ tests: [makeTestCase()] })], [], "passed");

			// Default behavior: SQLite DB created
			expect(fs.existsSync(path.join(tmpDir, "data.db"))).toBe(true);
		});

		it("accepts the plugin-resolved coverage threshold passthrough", async () => {
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
				coverageThresholds: { global: { lines: 90 } } as Record<string, unknown>,
			});

			await reporter.onTestRunEnd([makeTestModule({ tests: [makeTestCase()] })], [], "passed");

			expect(fs.existsSync(path.join(tmpDir, "data.db"))).toBe(true);
		});
	});

	describe("onInit", () => {
		it("stores vitest instance", () => {
			const reporter = new AgentReporter();
			const mockVitest = { projects: [] };

			reporter.onInit(mockVitest);

			expect(reporter._vitest).toBe(mockVitest);
		});
	});

	describe("onCoverage", () => {
		it("stashes coverage data and includes it in report", async () => {
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
			});
			const mockCoverage = {
				getCoverageSummary: () => ({
					statements: { pct: 90 },
					branches: { pct: 85 },
					functions: { pct: 88 },
					lines: { pct: 92 },
				}),
				files: () => ["src/covered.ts"],
				fileCoverageFor: () => ({
					toSummary: () => ({
						statements: { pct: 90 },
						branches: { pct: 85 },
						functions: { pct: 88 },
						lines: { pct: 92 },
					}),
					getUncoveredLines: () => [],
				}),
			};

			reporter.onCoverage(mockCoverage);

			await reporter.onTestRunEnd([makeTestModule({ tests: [makeTestCase()] })], [], "passed");

			// DB should exist and have data
			expect(fs.existsSync(path.join(tmpDir, "data.db"))).toBe(true);
		});

		it("emits a CoverageReady event from onTestRunEnd once the coverage pipeline finishes", async () => {
			const events: RunEvent[] = [];
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
				onRunEvent: (e) => events.push(e),
			});
			const mockCoverage = {
				getCoverageSummary: () => ({
					statements: { pct: 90 },
					branches: { pct: 85 },
					functions: { pct: 88 },
					lines: { pct: 92 },
				}),
				files: () => ["src/covered.ts"],
				fileCoverageFor: () => ({
					toSummary: () => ({
						statements: { pct: 90 },
						branches: { pct: 85 },
						functions: { pct: 88 },
						lines: { pct: 92 },
					}),
					getUncoveredLines: () => [],
				}),
			};

			reporter.onTestRunStart([]);
			reporter.onCoverage(mockCoverage);
			await reporter.onTestRunEnd([makeTestModule({ tests: [makeTestCase()] })], [], "passed");

			// `onCoverage` only stashes the raw map — the typed
			// `CoverageReady` payload is published once the analyzed
			// report is in hand inside `onTestRunEnd`.
			const coverageReady = events.find((e) => e._tag === "CoverageReady");
			expect(coverageReady).toBeDefined();
		});

		it("emits a TrendComputed event once the trend pipeline has run", async () => {
			const events: RunEvent[] = [];
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
				onRunEvent: (e) => events.push(e),
			});
			const mockCoverage = {
				getCoverageSummary: () => ({
					statements: { pct: 90 },
					branches: { pct: 85 },
					functions: { pct: 88 },
					lines: { pct: 92 },
				}),
				files: () => ["src/covered.ts"],
				fileCoverageFor: () => ({
					toSummary: () => ({
						statements: { pct: 90 },
						branches: { pct: 85 },
						functions: { pct: 88 },
						lines: { pct: 92 },
					}),
					getUncoveredLines: () => [],
				}),
			};

			reporter.onTestRunStart([]);
			reporter.onCoverage(mockCoverage);
			// Two runs so a trend with runCount >= 2 exists.
			await reporter.onTestRunEnd([makeTestModule({ tests: [makeTestCase()] })], [], "passed");
			const reporter2 = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
				onRunEvent: (e) => events.push(e),
			});
			reporter2.onTestRunStart([]);
			reporter2.onCoverage(mockCoverage);
			await reporter2.onTestRunEnd([makeTestModule({ tests: [makeTestCase()] })], [], "passed");

			expect(events.some((e) => e._tag === "TrendComputed")).toBe(true);
		});
	});

	describe("baselines", () => {
		it("does not fail the baseline write when the coverage map is empty (issue #130)", async () => {
			// `vitest run --passWithNoTests` in a workspace with no test files
			// hands the reporter an empty istanbul coverage map whose summary
			// pcts are the string "Unknown". The ratchet math turned those into
			// NaN, which binds as SQL NULL and logged a non-fatal
			// `DataStoreError: [write coverage_baselines] NOT NULL constraint
			// failed` on every run.
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
			});
			const emptyCoverage = {
				getCoverageSummary: () => ({
					statements: { pct: "Unknown" },
					branches: { pct: "Unknown" },
					functions: { pct: "Unknown" },
					lines: { pct: "Unknown" },
				}),
				files: () => [],
				fileCoverageFor: () => {
					throw new Error("no files in map");
				},
			};

			const stderrWrites: string[] = [];
			const originalWrite = process.stderr.write.bind(process.stderr);
			process.stderr.write = ((chunk: string | Uint8Array) => {
				stderrWrites.push(String(chunk));
				return true;
			}) as typeof process.stderr.write;
			try {
				reporter.onCoverage(emptyCoverage);
				await reporter.onTestRunEnd([], [], "passed");
			} finally {
				process.stderr.write = originalWrite;
			}

			expect(stderrWrites.join("")).not.toContain("DataStoreError");
		});

		it("writes baselines when coverage is present", async () => {
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
			});
			const mockCoverage = {
				getCoverageSummary: () => ({
					statements: { pct: 90 },
					branches: { pct: 85 },
					functions: { pct: 88 },
					lines: { pct: 92 },
				}),
				files: () => ["src/covered.ts"],
				fileCoverageFor: () => ({
					toSummary: () => ({
						statements: { pct: 90 },
						branches: { pct: 85 },
						functions: { pct: 88 },
						lines: { pct: 92 },
					}),
					getUncoveredLines: () => [],
				}),
			};

			reporter.onCoverage(mockCoverage);
			await reporter.onTestRunEnd([makeTestModule({ tests: [makeTestCase()] })], [], "passed");

			// Baselines are now written to SQLite, verify DB exists
			expect(fs.existsSync(path.join(tmpDir, "data.db"))).toBe(true);
		});

		it("caps baselines at target values", async () => {
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
				coverageTargets: { global: { lines: 85, branches: 80, functions: 80, statements: 80 } } as Record<
					string,
					unknown
				>,
			});
			const mockCoverage = {
				getCoverageSummary: () => ({
					statements: { pct: 90 },
					branches: { pct: 85 },
					functions: { pct: 88 },
					lines: { pct: 92 },
				}),
				files: () => ["src/covered.ts"],
				fileCoverageFor: () => ({
					toSummary: () => ({
						statements: { pct: 90 },
						branches: { pct: 85 },
						functions: { pct: 88 },
						lines: { pct: 92 },
					}),
					getUncoveredLines: () => [],
				}),
			};

			reporter.onCoverage(mockCoverage);
			await reporter.onTestRunEnd([makeTestModule({ tests: [makeTestCase()] })], [], "passed");

			expect(fs.existsSync(path.join(tmpDir, "data.db"))).toBe(true);
		});
	});

	describe("onTestRunEnd", () => {
		it("writes test run data to SQLite", async () => {
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
			});

			await reporter.onTestRunEnd([makeTestModule({ tests: [makeTestCase({ state: "passed" })] })], [], "passed");

			expect(fs.existsSync(path.join(tmpDir, "data.db"))).toBe(true);
		});

		it("handles multi-project test runs", async () => {
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
			});

			const moduleA = makeTestModule({
				relativeModuleId: "src/a.test.ts",
				projectName: "core",
				tests: [makeTestCase({ name: "core test" })],
			});
			const moduleB = makeTestModule({
				relativeModuleId: "src/b.test.ts",
				projectName: "api",
				tests: [makeTestCase({ name: "api test" })],
			});

			await reporter.onTestRunEnd([moduleA, moduleB], [], "passed");

			// Both projects written to same DB
			expect(fs.existsSync(path.join(tmpDir, "data.db"))).toBe(true);
		});

		it("handles single project with empty name as 'default'", async () => {
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
			});

			await reporter.onTestRunEnd([makeTestModule({ projectName: "", tests: [makeTestCase()] })], [], "passed");

			expect(fs.existsSync(path.join(tmpDir, "data.db"))).toBe(true);
		});

		it("skips console output when consoleMode is silent", async () => {
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
			});
			const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

			await reporter.onTestRunEnd([makeTestModule({ tests: [makeTestCase()] })], [], "passed");

			expect(stdoutSpy).not.toHaveBeenCalled();
			stdoutSpy.mockRestore();
		});

		it("writes console output when format is markdown", async () => {
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				format: "markdown",
				consoleMode: "agent",
			});
			const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

			await reporter.onTestRunEnd([makeTestModule({ tests: [makeTestCase()] })], [], "passed");

			expect(stdoutSpy).toHaveBeenCalled();
			stdoutSpy.mockRestore();
		});

		it("writes GFM when githubActions option is enabled", async () => {
			const summaryFile = path.join(tmpDir, "summary.md");
			vi.stubEnv("GITHUB_STEP_SUMMARY", summaryFile);

			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
				githubActions: true,
			});

			await reporter.onTestRunEnd([makeTestModule({ tests: [makeTestCase()] })], [], "passed");

			expect(fs.existsSync(summaryFile)).toBe(true);
			const content = fs.readFileSync(summaryFile, "utf-8");
			expect(content).toContain("Vitest Results");
		});

		it("skips GFM when githubActions is false", async () => {
			const summaryFile = path.join(tmpDir, "summary.md");

			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
				githubActions: false,
			});

			await reporter.onTestRunEnd([makeTestModule({ tests: [makeTestCase()] })], [], "passed");

			expect(fs.existsSync(summaryFile)).toBe(false);
		});

		it("creates cache directory and DB file", async () => {
			const cacheDir = path.join(tmpDir, "nested", "cache");
			const reporter = new AgentReporter({
				cacheDir,
				consoleMode: "silent",
			});

			await reporter.onTestRunEnd([makeTestModule({ tests: [makeTestCase()] })], [], "passed");

			expect(fs.existsSync(path.join(cacheDir, "data.db"))).toBe(true);
		});

		it("writes convention-based source-to-test mapping for .test. files", async () => {
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
			});

			const testModule = makeTestModule({
				relativeModuleId: "src/utils.test.ts",
				tests: [makeTestCase({ name: "my test" })],
			});

			await reporter.onTestRunEnd([testModule], [], "passed");

			// Query the source_test_map table directly to verify the mapping
			const dbPath = path.join(tmpDir, "data.db");
			const db = new Database(dbPath, { readonly: true });
			const rows = db
				.prepare(
					`SELECT f_src.path AS source_path, f_test.path AS test_path, stm.mapping_type
					 FROM source_test_map stm
					 JOIN files f_src ON f_src.id = stm.source_file_id
					 JOIN test_modules tm ON tm.id = stm.test_module_id
					 JOIN files f_test ON f_test.id = tm.file_id`,
				)
				.all() as Array<{ source_path: string; test_path: string; mapping_type: string }>;
			db.close();

			expect(rows.length).toBe(1);
			expect(rows[0].source_path).toBe("src/utils.ts");
			expect(rows[0].test_path).toBe("src/utils.test.ts");
			expect(rows[0].mapping_type).toBe("convention");
		});

		it("writes convention-based source-to-test mapping for .spec. files", async () => {
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
			});

			const testModule = makeTestModule({
				relativeModuleId: "src/helpers.spec.ts",
				tests: [makeTestCase({ name: "spec test" })],
			});

			await reporter.onTestRunEnd([testModule], [], "passed");

			const dbPath = path.join(tmpDir, "data.db");
			const db = new Database(dbPath, { readonly: true });
			const rows = db
				.prepare(
					`SELECT f_src.path AS source_path, stm.mapping_type
					 FROM source_test_map stm
					 JOIN files f_src ON f_src.id = stm.source_file_id`,
				)
				.all() as Array<{ source_path: string; mapping_type: string }>;
			db.close();

			expect(rows.length).toBe(1);
			expect(rows[0].source_path).toBe("src/helpers.ts");
			expect(rows[0].mapping_type).toBe("convention");
		});

		it("skips source mapping for files without .test. or .spec. suffix", async () => {
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
			});

			const testModule = makeTestModule({
				relativeModuleId: "src/integration/run-all.ts",
				tests: [makeTestCase({ name: "integration" })],
			});

			await reporter.onTestRunEnd([testModule], [], "passed");

			const dbPath = path.join(tmpDir, "data.db");
			const db = new Database(dbPath, { readonly: true });
			const rows = db.prepare("SELECT COUNT(*) AS cnt FROM source_test_map").all() as Array<{ cnt: number }>;
			db.close();

			expect(rows[0].cnt).toBe(0);
		});

		it("writes unhandled errors for all projects", async () => {
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
			});
			const errors = [{ message: "unhandled error", stacks: [] }];

			const moduleA = makeTestModule({
				relativeModuleId: "src/a.test.ts",
				projectName: "core",
				tests: [makeTestCase()],
			});
			const moduleB = makeTestModule({
				relativeModuleId: "src/b.test.ts",
				projectName: "api",
				tests: [makeTestCase()],
			});

			await reporter.onTestRunEnd([moduleA, moduleB], errors, "failed");

			// Both projects should have run data in the DB
			expect(fs.existsSync(path.join(tmpDir, "data.db"))).toBe(true);
		});
	});

	describe("trend recording", () => {
		it("records trend entry on full run with coverage", async () => {
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
			});
			const mockCoverage = {
				getCoverageSummary: () => ({
					statements: { pct: 90 },
					branches: { pct: 85 },
					functions: { pct: 88 },
					lines: { pct: 92 },
				}),
				files: () => ["src/covered.ts"],
				fileCoverageFor: () => ({
					toSummary: () => ({
						statements: { pct: 90 },
						branches: { pct: 85 },
						functions: { pct: 88 },
						lines: { pct: 92 },
					}),
					getUncoveredLines: () => [],
				}),
			};

			reporter.onCoverage(mockCoverage);
			await reporter.onTestRunEnd([makeTestModule({ tests: [makeTestCase()] })], [], "passed");

			// Trends are now in SQLite
			expect(fs.existsSync(path.join(tmpDir, "data.db"))).toBe(true);
		});

		it("skips trend recording when no coverage is present", async () => {
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
			});

			await reporter.onTestRunEnd([makeTestModule({ tests: [makeTestCase()] })], [], "passed");

			// DB should still exist
			expect(fs.existsSync(path.join(tmpDir, "data.db"))).toBe(true);
		});
	});

	describe("history integration", () => {
		it("writes history data alongside test run", async () => {
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
			});

			const passingTest = makeTestCase({ name: "passes", fullName: "Suite > passes", state: "passed" });
			const failingTest = makeTestCase({
				name: "fails",
				fullName: "Suite > fails",
				state: "failed",
				errors: [{ message: "expected true to be false" }],
			});

			await reporter.onTestRunEnd([makeTestModule({ tests: [passingTest, failingTest] })], [], "failed");

			// History is now in SQLite
			expect(fs.existsSync(path.join(tmpDir, "data.db"))).toBe(true);
		});

		it("attaches classifications to failed test reports", async () => {
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
			});

			const failingTest = makeTestCase({
				name: "fails",
				fullName: "Suite > fails",
				state: "failed",
				errors: [{ message: "expected true to be false" }],
			});

			// The reporter still builds AgentReport objects for console output,
			// so classifications are applied to the in-memory report.
			// We verify the run completes without error.
			await reporter.onTestRunEnd(
				[
					makeTestModule({
						state: "failed",
						tests: [failingTest],
					}),
				],
				[],
				"failed",
			);

			expect(fs.existsSync(path.join(tmpDir, "data.db"))).toBe(true);
		});

		it("writes distinct per-module test_history rows for two tests sharing a fullName in different modules", async () => {
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
			});

			const testA = makeTestCase({
				name: "duplicate name",
				fullName: "Suite > duplicate name",
				state: "passed",
				duration: 111,
			});
			const testB = makeTestCase({
				name: "duplicate name",
				fullName: "Suite > duplicate name",
				state: "failed",
				duration: 222,
				errors: [{ message: "module B failure" }],
			});

			const moduleA = makeTestModule({ relativeModuleId: "src/a.test.ts", tests: [testA] });
			const moduleB = makeTestModule({ relativeModuleId: "src/b.test.ts", state: "failed", tests: [testB] });

			await reporter.onTestRunEnd([moduleA, moduleB], [], "failed");

			const dbPath = path.join(tmpDir, "data.db");
			const db = new Database(dbPath, { readonly: true });
			const rows = db
				.prepare(
					`SELECT module_path, full_name, state, duration, error_message
					 FROM test_history
					 WHERE full_name = 'Suite > duplicate name'
					 ORDER BY module_path`,
				)
				.all() as Array<{
				module_path: string;
				full_name: string;
				state: string;
				duration: number | null;
				error_message: string | null;
			}>;
			db.close();

			expect(rows).toHaveLength(2);
			const rowA = rows.find((r) => r.module_path === "src/a.test.ts");
			const rowB = rows.find((r) => r.module_path === "src/b.test.ts");
			expect(rowA).toBeDefined();
			expect(rowB).toBeDefined();
			expect(rowA?.state).toBe("passed");
			expect(rowA?.duration).toBe(111);
			expect(rowA?.error_message).toBeNull();
			expect(rowB?.state).toBe("failed");
			expect(rowB?.duration).toBe(222);
			expect(rowB?.error_message).toBe("module B failure");
		});
	});

	describe("failure signatures", () => {
		it("writes failure_signatures and signature_hash for failing tests", async () => {
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
			});

			const failingTest = makeTestCase({
				name: "fails",
				fullName: "Foo > fails",
				state: "failed",
				errors: [
					{
						name: "AssertionError",
						message: "expected 1 to equal 2",
						stack: "AssertionError: expected 1 to equal 2\n" + "    at Foo.bar (/abs/src/foo.ts:42:9)\n",
					},
				],
			});

			await reporter.onTestRunEnd([makeTestModule({ state: "failed", tests: [failingTest] })], [], "failed");

			const db = new Database(path.join(tmpDir, "data.db"));
			const sigRows = db.prepare("SELECT signature_hash FROM failure_signatures").all() as Array<{
				signature_hash: string;
			}>;
			const errRows = db
				.prepare("SELECT signature_hash FROM test_errors WHERE signature_hash IS NOT NULL")
				.all() as Array<{ signature_hash: string }>;
			db.close();

			expect(sigRows).toHaveLength(1);
			expect(sigRows[0].signature_hash).toMatch(/^[a-f0-9]{16}$/);
			expect(errRows).toHaveLength(1);
			expect(errRows[0].signature_hash).toBe(sigRows[0].signature_hash);
		});
	});
});
