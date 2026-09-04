/**
 * vitest-agent-plugin
 *
 * Tests for AgentReporter class.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RunEvent, VitestTestCase, VitestTestModule } from "@vitest-agent/sdk";
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

	/**
	 * Drives `onInit` + `onTestRunEnd` for one module list against a fresh
	 * `AgentReporter` that owns stdout (`consoleMode: "agent"` renders the
	 * dispatched agent-string), capturing both stdout and stderr writes so
	 * render-despite-persistence-failure tests can assert on both streams.
	 */
	async function runReporterEnd(
		modules: VitestTestModule[],
		options: { reason?: "passed" | "failed" | "interrupted"; cacheDir?: string } = {},
	): Promise<{ stdout: string[]; stderr: string[] }> {
		const reporter = new AgentReporter({
			cacheDir: options.cacheDir ?? tmpDir,
			consoleMode: "agent",
		});
		const stdout: string[] = [];
		const stderr: string[] = [];
		const originalStdoutWrite = process.stdout.write.bind(process.stdout);
		const originalStderrWrite = process.stderr.write.bind(process.stderr);
		process.stdout.write = ((chunk: string | Uint8Array) => {
			stdout.push(String(chunk));
			return true;
		}) as typeof process.stdout.write;
		process.stderr.write = ((chunk: string | Uint8Array) => {
			stderr.push(String(chunk));
			return true;
		}) as typeof process.stderr.write;
		try {
			await reporter.onInit(undefined);
			await reporter.onTestRunEnd(modules, [], options.reason ?? "failed");
		} finally {
			process.stdout.write = originalStdoutWrite;
			process.stderr.write = originalStderrWrite;
		}
		return { stdout, stderr };
	}

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

		it("persists resolved thresholds and targets distinctly from the ratcheted baseline (issue #237)", async () => {
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
				coverageThresholds: { global: { lines: 70, functions: 70 } } as Record<string, unknown>,
				coverageTargets: { global: { lines: 90, functions: 90 } } as Record<string, unknown>,
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

			const dbPath = path.join(tmpDir, "data.db");
			const db = new DatabaseSync(dbPath, { readOnly: true });
			const rows = db
				.prepare(
					"SELECT kind, metric, value FROM coverage_baselines WHERE project = '__global__' ORDER BY kind, metric",
				)
				.all() as Array<{ kind: string; metric: string; value: number }>;
			db.close();

			const thresholdRows = rows.filter((r) => r.kind === "threshold");
			const targetRows = rows.filter((r) => r.kind === "target");
			expect(thresholdRows.find((r) => r.metric === "lines")?.value).toBe(70);
			expect(thresholdRows.find((r) => r.metric === "functions")?.value).toBe(70);
			expect(targetRows.find((r) => r.metric === "lines")?.value).toBe(90);
			expect(targetRows.find((r) => r.metric === "functions")?.value).toBe(90);
		});

		it("writes no threshold rows when coverageThresholds is not configured", async () => {
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

			const dbPath = path.join(tmpDir, "data.db");
			const db = new DatabaseSync(dbPath, { readOnly: true });
			const rows = db
				.prepare("SELECT COUNT(*) AS cnt FROM coverage_baselines WHERE kind IN ('threshold', 'target')")
				.get() as { cnt: number };
			db.close();

			expect(rows.cnt).toBe(0);
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
			const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

			// A first-ever failure classifies as "new-failure", which is the
			// signal renderGithubSummary's Classifications section is built to
			// surface — a clean/stable run intentionally emits no summary.
			await reporter.onTestRunEnd(
				[makeTestModule({ tests: [makeTestCase({ state: "failed", errors: [{ message: "boom" }] })] })],
				[],
				"failed",
			);

			expect(fs.existsSync(summaryFile)).toBe(true);
			const content = fs.readFileSync(summaryFile, "utf-8");
			expect(content).toContain("## vitest-agent");
			expect(content).toContain("### Classifications");
			expect(content).toContain("new-failure");
			const stdoutWrites = stdoutSpy.mock.calls.map((call) => call[0]).join("");
			expect(stdoutWrites).toContain("::group::vitest-agent");
			stdoutSpy.mockRestore();
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
			const db = new DatabaseSync(dbPath, { readOnly: true });
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
			const db = new DatabaseSync(dbPath, { readOnly: true });
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
			const db = new DatabaseSync(dbPath, { readOnly: true });
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

		it("coerces a non-Error failure value instead of crashing the run summary (issue #195)", async () => {
			// message is typed string but is a plain object at runtime (Effect.flip
			// shape). A second, all-passing project keeps the run at >1 project so
			// the dispatcher picks the "workspace" cell, whose "Total:" line
			// reports the aggregate fail count instead of the header-less
			// "single-test" cell's bare failure block.
			const passingModule = makeTestModule({
				relativeModuleId: "src/api.test.ts",
				projectName: "api",
				tests: [makeTestCase({ name: "passes", state: "passed" })],
			});
			const failingModule = makeTestModule({
				relativeModuleId: "src/core.test.ts",
				projectName: "core",
				tests: [
					makeTestCase({
						name: "flips",
						state: "failed",
						errors: [{ message: { a: 1 } as unknown as string }],
					}),
				],
				state: "failed",
			});
			const { stdout, stderr } = await runReporterEnd([passingModule, failingModule]);
			expect(stderr.join("")).not.toContain("DataStoreError");
			expect(stdout.join("")).toContain("1 failed"); // summary rendered
			// And the DB row landed with a stringified message:
			const dbPath = path.join(tmpDir, "data.db");
			const db = new DatabaseSync(dbPath);
			const row = db.prepare("SELECT message FROM test_errors ORDER BY id DESC LIMIT 1").get() as { message: string };
			expect(row.message).toBe('{"a":1}');
		});

		it("still renders the summary when the DB is unusable (issue #143)", async () => {
			// Corrupt the db file so ensureMigrated/persistence fails.
			const dbPath = path.join(tmpDir, "data.db");
			fs.writeFileSync(dbPath, "this is not a sqlite database");
			const passingModule = makeTestModule({
				relativeModuleId: "src/api.test.ts",
				projectName: "api",
				tests: [makeTestCase({ name: "passes", state: "passed" })],
			});
			const failingModule = makeTestModule({
				relativeModuleId: "src/core.test.ts",
				projectName: "core",
				tests: [makeTestCase({ name: "boom", state: "failed", errors: [{ message: "assertion failed" }] })],
				state: "failed",
			});
			const { stdout, stderr } = await runReporterEnd([passingModule, failingModule]);
			expect(stdout.join("")).toContain("1 failed"); // the summary is the point
			expect(stderr.join("")).toContain("NOT recorded"); // loud, but secondary
		});

		it("still renders the summary when the cache directory is unusable (dbPath resolution fails)", async () => {
			// A regular file where a directory is needed: mkdirSync inside
			// ensureDbPath throws ENOTDIR, so dbPath never resolves. The run
			// must still render, with persistence disabled and flagged.
			const blocker = path.join(tmpDir, "blocker");
			fs.writeFileSync(blocker, "a file, not a directory");
			const failingModule = makeTestModule({
				relativeModuleId: "src/core.test.ts",
				projectName: "core",
				tests: [makeTestCase({ name: "boom", state: "failed", errors: [{ message: "assertion failed" }] })],
				state: "failed",
			});
			const { stdout, stderr } = await runReporterEnd([failingModule], {
				cacheDir: path.join(blocker, "nested"),
			});
			// Single-module runs render through the single-test cell (failure
			// name, no aggregate count line) — assert the failure rendered.
			expect(stdout.join("")).toContain("boom");
			expect(stderr.join("")).toContain("NOT recorded");
		});

		it("writes per-project reasons — a clean project is not failed by a sibling (issue #147)", async () => {
			const failingMod = makeTestModule({
				relativeModuleId: "pkg-a/x.test.ts",
				projectName: "pkg-a",
				state: "failed",
				tests: [makeTestCase({ name: "bad", state: "failed", errors: [{ message: "nope" }] })],
			});
			const cleanMod = makeTestModule({
				relativeModuleId: "pkg-b/y.test.ts",
				projectName: "pkg-b",
				state: "passed",
				tests: [makeTestCase({ name: "good", state: "passed" })],
			});
			await runReporterEnd([failingMod, cleanMod], { reason: "failed" });
			const dbPath = path.join(tmpDir, "data.db");
			const db = new DatabaseSync(dbPath);
			const rows = db.prepare("SELECT project, reason FROM test_runs ORDER BY project").all() as Array<{
				project: string;
				reason: string;
			}>;
			expect(rows).toEqual([
				{ project: "pkg-a", reason: "failed" },
				{ project: "pkg-b", reason: "passed" },
			]);
		});

		it("does not reject onTestRunEnd when a duck-typed module throws building the fallback report", async () => {
			// state() throwing simulates a malformed reporter-shape module. The
			// fallback report build runs bare, before ensureMigrated, so an
			// unguarded throw here would reject onTestRunEnd itself with no
			// render, no persist, and no formatted stderr.
			const throwingModule: VitestTestModule = {
				type: "module",
				moduleId: "/abs/src/boom.test.ts",
				relativeModuleId: "src/boom.test.ts",
				project: { name: "" },
				state: () => {
					throw new Error("state() blew up");
				},
				children: {
					*allTests() {},
					*allSuites() {},
				},
				diagnostic: () => ({ duration: 0 }),
				errors: () => [],
			};

			const { stdout, stderr } = await runReporterEnd([throwingModule]);

			expect(stderr.join("")).toContain("state() blew up");
			expect(stdout.join("")).toBe("");
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
			const db = new DatabaseSync(dbPath, { readOnly: true });
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

			const db = new DatabaseSync(path.join(tmpDir, "data.db"));
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

	describe("scoped/partial run coverage (issue #160)", () => {
		it("persists scoped=true on the test_runs row when vitest.filenamePattern indicates a partial run", async () => {
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
			});
			// A partial run: an explicit file filter set vitest.filenamePattern.
			reporter._vitest = { config: {}, version: "test", filenamePattern: ["src/foo.test.ts"] };

			await reporter.onTestRunEnd([makeTestModule({ tests: [makeTestCase()] })], [], "passed");

			const dbPath = path.join(tmpDir, "data.db");
			const db = new DatabaseSync(dbPath, { readOnly: true });
			const row = db.prepare("SELECT scoped FROM test_runs LIMIT 1").get() as { scoped: number };
			db.close();

			expect(row.scoped).toBe(1);
		});

		it("does not emit ThresholdViolation events on a partial run even when a metric is below threshold", async () => {
			const events: RunEvent[] = [];
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
				coverageThresholds: { global: { lines: 95 } } as Record<string, unknown>,
				onRunEvent: (e) => events.push(e),
			});
			reporter._vitest = { config: {}, version: "test", filenamePattern: ["src/foo.test.ts"] };
			const mockCoverage = {
				getCoverageSummary: () => ({
					statements: { pct: 40 },
					branches: { pct: 40 },
					functions: { pct: 40 },
					lines: { pct: 40 },
				}),
				files: () => ["src/foo.ts"],
				fileCoverageFor: () => ({
					toSummary: () => ({
						statements: { pct: 40 },
						branches: { pct: 40 },
						functions: { pct: 40 },
						lines: { pct: 40 },
					}),
					getUncoveredLines: () => [],
				}),
			};
			reporter.onTestRunStart([]);
			reporter.onCoverage(mockCoverage);

			await reporter.onTestRunEnd([makeTestModule({ tests: [makeTestCase()] })], [], "passed");

			expect(events.some((e) => e._tag === "ThresholdViolation")).toBe(false);
			expect(events.some((e) => e._tag === "CoverageReady")).toBe(true);
		});

		it("neutralizes vitest.coverageProvider.options.thresholds on a partial run", async () => {
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
			});
			const thresholds: Record<string, unknown> = {
				lines: 90,
				functions: 90,
				branches: 90,
				statements: 90,
				perFile: true,
				autoUpdate: false,
				"src/special/**": { lines: 100 },
			};
			const mockVitest = {
				config: {},
				version: "test",
				filenamePattern: ["src/foo.test.ts"],
				coverageProvider: { options: { thresholds } },
			};
			reporter._vitest = mockVitest;

			await reporter.onTestRunEnd([makeTestModule({ tests: [makeTestCase()] })], [], "passed");

			expect(thresholds.lines).toBeUndefined();
			expect(thresholds.functions).toBeUndefined();
			expect(thresholds.branches).toBeUndefined();
			expect(thresholds.statements).toBeUndefined();
			expect(thresholds["src/special/**"]).toBeUndefined();
			expect(thresholds.perFile).toBe(true);
			expect(thresholds.autoUpdate).toBe(false);
		});

		it("skips writing coverage thresholds/targets rows on a partial run (issue #237 follow-up)", async () => {
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
				coverageThresholds: { global: { lines: 70 } } as Record<string, unknown>,
				coverageTargets: { global: { lines: 90 } } as Record<string, unknown>,
			});
			reporter._vitest = { config: {}, version: "test", filenamePattern: ["src/foo.test.ts"] };
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

			const dbPath = path.join(tmpDir, "data.db");
			const db = new DatabaseSync(dbPath, { readOnly: true });
			const rows = db
				.prepare("SELECT COUNT(*) AS cnt FROM coverage_baselines WHERE kind IN ('threshold', 'target')")
				.get() as { cnt: number };
			db.close();

			expect(rows.cnt).toBe(0);
		});

		it("persists scoped=true from the spec-count signal alone — no filenamePattern or projectFilter (tags-only run, issue #160 gap 2)", async () => {
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
			});
			const mockVitest = {
				config: {},
				version: "test",
				// No filenamePattern, no projectFilter — a tags-only `run_tests`
				// call narrows the run without either signal. Only the
				// spec-count comparison can catch it.
				globTestSpecifications: async () => new Array(10).fill({}),
			};
			reporter._vitest = mockVitest;
			// 2 specifications started, out of 10 total.
			reporter.onTestRunStart([{}, {}]);

			await reporter.onTestRunEnd([makeTestModule({ tests: [makeTestCase()] })], [], "passed");

			const dbPath = path.join(tmpDir, "data.db");
			const db = new DatabaseSync(dbPath, { readOnly: true });
			const row = db.prepare("SELECT scoped FROM test_runs LIMIT 1").get() as { scoped: number };
			db.close();

			expect(row.scoped).toBe(1);
		});

		it("degrades to not-partial (via the spec-count channel) when globTestSpecifications throws", async () => {
			const reporter = new AgentReporter({
				cacheDir: tmpDir,
				consoleMode: "silent",
			});
			const mockVitest = {
				config: {},
				version: "test",
				globTestSpecifications: async () => {
					throw new Error("boom");
				},
			};
			reporter._vitest = mockVitest;
			reporter.onTestRunStart([{}, {}]);

			await reporter.onTestRunEnd([makeTestModule({ tests: [makeTestCase()] })], [], "passed");

			const dbPath = path.join(tmpDir, "data.db");
			const db = new DatabaseSync(dbPath, { readOnly: true });
			const row = db.prepare("SELECT scoped FROM test_runs LIMIT 1").get() as { scoped: number };
			db.close();

			expect(row.scoped).toBe(0);
		});
	});
});
