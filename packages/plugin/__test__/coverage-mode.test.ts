/**
 * Phase 4 + Phase 5 integration tests: coverageMode threading + ConfigValidation wiring.
 *
 * Spec §5.3 — drives configureVitest against an in-memory Vitest config and
 * verifies that the coverageMode field flows through to the AgentReporter's
 * resolved config, and that validation errors from ConfigValidation cause
 * configureVitest to throw.
 *
 * Phase 5 cases extend this file with two-mode persistence tests:
 * - Full mode persists to DB (test_runs row written)
 * - UI-only mode skips persistence (no test_runs row, reporter factory called)
 * - Per-run flip: Full then UI-only leaves exactly one row
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EnvironmentDetectorTest } from "@vitest-agent/engine";
import type { VitestTestCase, VitestTestModule } from "@vitest-agent/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VitestPluginContext } from "vitest/node";
import { AgentPlugin } from "../src/plugin.js";
import { AgentReporter } from "../src/reporter.js";

function mockVitest(coverageEnabled?: boolean, thresholds?: Record<string, unknown>) {
	const coverage: Record<string, unknown> = {};
	if (coverageEnabled !== undefined) {
		coverage.enabled = coverageEnabled;
	}
	if (thresholds !== undefined) {
		coverage.thresholds = thresholds;
	}
	return {
		config: {
			reporters: ["default" as unknown],
			coverage,
		},
		vite: { config: { cacheDir: "node_modules/.vite" } },
		onClose: vi.fn(),
	};
}

async function callConfigureVitest(plugin: ReturnType<typeof AgentPlugin>, vitest: ReturnType<typeof mockVitest>) {
	const ctx = {
		vitest,
		project: { name: undefined },
		defineCacheKeyGenerator: vi.fn(),
	} as unknown as VitestPluginContext;
	await plugin.configureVitest(ctx);
}

describe("coverageMode threading (Phase 4 §5.3)", () => {
	let stderrWrite: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	});

	afterEach(() => {
		stderrWrite.mockRestore();
		vi.unstubAllEnvs();
	});

	it("should resolve coverageMode as 'full' when coverage.enabled is omitted", async () => {
		const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("agent-shell"));
		const vitest = mockVitest(/* enabled omitted */);
		await callConfigureVitest(plugin, vitest);

		const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
		expect(reporter).toBeDefined();
		// The resolved config must carry coverageMode: "full"
		expect(reporter.resolvedConfig.coverageMode).toBe("full");
	});

	it("should resolve coverageMode as 'full' when coverage.enabled is explicitly true", async () => {
		const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("agent-shell"));
		const vitest = mockVitest(true);
		await callConfigureVitest(plugin, vitest);

		const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
		expect(reporter).toBeDefined();
		expect(reporter.resolvedConfig.coverageMode).toBe("full");
	});

	it("should resolve coverageMode as 'ui-only' when coverage.enabled is false", async () => {
		const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("agent-shell"));
		const vitest = mockVitest(false);
		await callConfigureVitest(plugin, vitest);

		const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
		expect(reporter).toBeDefined();
		expect(reporter.resolvedConfig.coverageMode).toBe("ui-only");
	});

	it("should throw with TARGET_BELOW_THRESHOLD when coverageTargets.lines is below coverage.thresholds.lines", async () => {
		const plugin = AgentPlugin({ coverageTargets: { lines: 50 } }, EnvironmentDetectorTest.layer("agent-shell"));
		// target (50) < threshold (80) → TARGET_BELOW_THRESHOLD error
		const vitest = mockVitest(true, { lines: 80 });
		await expect(callConfigureVitest(plugin, vitest)).rejects.toThrow("TARGET_BELOW_THRESHOLD");
	});
});

// ---------------------------------------------------------------------------
// Phase 5 helpers
// ---------------------------------------------------------------------------

function makePhase5TestCase(
	overrides: Partial<{ name: string; fullName: string; state: string }> = {},
): VitestTestCase {
	const name = overrides.name ?? "a test";
	return {
		type: "test",
		name,
		fullName: overrides.fullName ?? name,
		tags: [],
		result: () => ({ state: overrides.state ?? "passed" }),
		diagnostic: () => ({ duration: 10, flaky: false, slow: false }),
	};
}

function makePhase5TestModule(
	overrides: Partial<{ projectName: string; tests: VitestTestCase[] }> = {},
): VitestTestModule {
	const tests = overrides.tests ?? [makePhase5TestCase()];
	return {
		type: "module",
		moduleId: "/abs/src/foo.test.ts",
		relativeModuleId: "src/foo.test.ts",
		project: { name: overrides.projectName ?? "" },
		state: () => "passed",
		children: {
			*allTests() {
				for (const t of tests) yield t;
			},
			*allSuites() {},
		},
		diagnostic: () => ({ duration: 50 }),
		errors: () => [],
	};
}

// ---------------------------------------------------------------------------
// Phase 5 §5.3 — two-mode persistence tests
// ---------------------------------------------------------------------------

describe("coverageMode persistence (Phase 5 §5.3)", () => {
	let tmpDir: string;
	let stderrWrite: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coverage-mode-p5-"));
		stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		stderrWrite.mockRestore();
		vi.unstubAllEnvs();
	});

	it("should write a test_runs row when coverageMode is full", async () => {
		// Given: a reporter in full mode with a tmpDir-backed DB
		const reporter = new AgentReporter({
			cacheDir: tmpDir,
			consoleMode: "silent",
			coverageMode: "full",
		});

		// When: onTestRunEnd is called
		await reporter.onTestRunEnd([makePhase5TestModule()], [], "passed");

		// Then: at least one row exists in test_runs
		const db = new DatabaseSync(path.join(tmpDir, "data.db"), { readOnly: true });
		const rows = db.prepare("SELECT COUNT(*) AS cnt FROM test_runs").all() as Array<{ cnt: number }>;
		db.close();
		expect(rows[0].cnt).toBeGreaterThanOrEqual(1);
	});

	it("should skip test_runs writes and call reporter factory when coverageMode is ui-only", async () => {
		// Given: a spy reporter factory and a reporter in ui-only mode
		const factory = vi.fn(() => ({ render: vi.fn(() => []) }));
		const runEvents: string[] = [];

		const reporter = new AgentReporter({
			cacheDir: tmpDir,
			consoleMode: "silent",
			coverageMode: "ui-only",
			reporter: factory,
			onRunEvent: (event) => {
				runEvents.push(event._tag);
			},
		});
		reporter.onTestRunStart([]);

		// When: onTestRunEnd is called
		await reporter.onTestRunEnd([makePhase5TestModule()], [], "passed");

		// Then: zero rows in test_runs (persistence was skipped).
		// In ui-only mode the DB file is never created (ensureMigrated is never called),
		// so a missing file counts as 0 rows.
		const dbFile = path.join(tmpDir, "data.db");
		let rowCount = 0;
		if (fs.existsSync(dbFile)) {
			const db = new DatabaseSync(dbFile, { readOnly: true });
			try {
				const rows = db.prepare("SELECT COUNT(*) AS cnt FROM test_runs").all() as Array<{ cnt: number }>;
				rowCount = rows[0].cnt;
			} catch {
				rowCount = 0;
			} finally {
				db.close();
			}
		}
		expect(rowCount).toBe(0);

		// And: the reporter factory was called
		expect(factory).toHaveBeenCalledOnce();

		// And: RunFinished tap fired
		expect(runEvents).toContain("RunFinished");
	});

	it("should not add a second test_runs row when ui-only run follows a full run", async () => {
		// Given: a full-mode run that writes a row
		const fullReporter = new AgentReporter({
			cacheDir: tmpDir,
			consoleMode: "silent",
			coverageMode: "full",
		});
		await fullReporter.onTestRunEnd([makePhase5TestModule()], [], "passed");

		// Verify we have exactly 1 row after the full run
		const db1 = new DatabaseSync(path.join(tmpDir, "data.db"), { readOnly: true });
		const after1 = (db1.prepare("SELECT COUNT(*) AS cnt FROM test_runs").all() as Array<{ cnt: number }>)[0].cnt;
		db1.close();
		expect(after1).toBe(1);

		// When: a ui-only run happens against the same cacheDir
		const uiOnlyReporter = new AgentReporter({
			cacheDir: tmpDir,
			consoleMode: "silent",
			coverageMode: "ui-only",
		});
		await uiOnlyReporter.onTestRunEnd([makePhase5TestModule()], [], "passed");

		// Then: still exactly 1 row (ui-only run added nothing)
		const db2 = new DatabaseSync(path.join(tmpDir, "data.db"), { readOnly: true });
		const after2 = (db2.prepare("SELECT COUNT(*) AS cnt FROM test_runs").all() as Array<{ cnt: number }>)[0].cnt;
		db2.close();
		expect(after2).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// Issue #625 — explicit SQLite persistence opt-out
// ---------------------------------------------------------------------------

function mockCoverageMap() {
	const summary = {
		statements: { pct: 90 },
		branches: { pct: 85 },
		functions: { pct: 88 },
		lines: { pct: 91 },
	};
	return {
		getCoverageSummary: () => summary,
		files: () => ["/abs/src/foo.ts"],
		fileCoverageFor: () => ({ toSummary: () => summary, getUncoveredLines: () => [3, 4] }),
	};
}

function countTestRuns(tmpDir: string): number {
	const dbFile = path.join(tmpDir, "data.db");
	if (!fs.existsSync(dbFile)) return 0;
	const db = new DatabaseSync(dbFile, { readOnly: true });
	try {
		return (db.prepare("SELECT COUNT(*) AS cnt FROM test_runs").all() as Array<{ cnt: number }>)[0].cnt;
	} finally {
		db.close();
	}
}

describe("persistence opt-out (#625)", () => {
	let tmpDir: string;
	let stderrWrite: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "persist-opt-out-"));
		stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		vi.stubEnv("VITEST_AGENT_PERSIST", "");
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		stderrWrite.mockRestore();
		vi.unstubAllEnvs();
	});

	it("persist: false skips every DB write but still renders, with coverage and run events", async () => {
		const factory = vi.fn(() => ({ render: vi.fn(() => []) }));
		const runEvents: string[] = [];
		const reporter = new AgentReporter({
			cacheDir: tmpDir,
			consoleMode: "silent",
			coverageMode: "full",
			persist: false,
			reporter: factory,
			onRunEvent: (event) => {
				runEvents.push(event._tag);
			},
		});
		reporter.onTestRunStart([]);
		reporter.onCoverage(mockCoverageMap());

		await reporter.onTestRunEnd([makePhase5TestModule()], [], "passed");

		// No data.db at all — not even an empty, migrated one.
		expect(fs.existsSync(path.join(tmpDir, "data.db"))).toBe(false);
		expect(countTestRuns(tmpDir)).toBe(0);

		// Rendering still happened, with coverage attached and no persistence warning.
		expect(factory).toHaveBeenCalledOnce();
		const render = factory.mock.results[0]?.value.render as ReturnType<typeof vi.fn>;
		expect(render).toHaveBeenCalledOnce();
		const [input, kit] = render.mock.calls[0] as [
			{ reports: Array<{ coverage?: unknown }>; classifications: Map<string, unknown> },
			{ config: { persist?: boolean; coverageMode: string } },
		];
		expect(input.reports[0]?.coverage).toBeDefined();
		expect(input.classifications.size).toBe(0);
		expect(kit.config.persist).toBe(false);
		expect(kit.config.coverageMode).toBe("full");
		expect(runEvents).toContain("RunFinished");
		expect(runEvents).toContain("CoverageReady");
		const stderrText = stderrWrite.mock.calls.map((c: unknown[]) => String(c[0])).join("");
		expect(stderrText).not.toContain("persistence failed");
	});

	it("persist defaults to true: a run with the option unset and the env var unset writes a test_runs row", async () => {
		const reporter = new AgentReporter({ cacheDir: tmpDir, consoleMode: "silent", coverageMode: "full" });
		await reporter.onTestRunEnd([makePhase5TestModule()], [], "passed");
		expect(reporter.resolvedConfig.persist).toBe(true);
		expect(countTestRuns(tmpDir)).toBe(1);
	});

	it.each(["0", "false"])("VITEST_AGENT_PERSIST=%s turns persistence off through configureVitest", async (value) => {
		vi.stubEnv("VITEST_AGENT_PERSIST", value);
		const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("agent-shell"));
		const vitest = mockVitest(true);
		await callConfigureVitest(plugin, vitest);

		const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
		expect(reporter.resolvedConfig.persist).toBe(false);
		expect(reporter.resolvedConfig.coverageMode).toBe("full");
	});

	it("persist: true with the env var unset persists as before", async () => {
		const plugin = AgentPlugin({ persist: true }, EnvironmentDetectorTest.layer("agent-shell"));
		const vitest = mockVitest(true);
		await callConfigureVitest(plugin, vitest);

		const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
		expect(reporter.resolvedConfig.persist).toBe(true);
	});

	it("VITEST_AGENT_PERSIST=0 is an operator override and beats persist: true", async () => {
		vi.stubEnv("VITEST_AGENT_PERSIST", "0");
		const plugin = AgentPlugin({ persist: true }, EnvironmentDetectorTest.layer("agent-shell"));
		const vitest = mockVitest(true);
		await callConfigureVitest(plugin, vitest);

		const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
		expect(reporter.resolvedConfig.persist).toBe(false);
	});

	it("VITEST_AGENT_PERSIST=1 beats persist: false", async () => {
		vi.stubEnv("VITEST_AGENT_PERSIST", "1");
		const plugin = AgentPlugin({ persist: false }, EnvironmentDetectorTest.layer("agent-shell"));
		const vitest = mockVitest(true);
		await callConfigureVitest(plugin, vitest);

		const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
		expect(reporter.resolvedConfig.persist).toBe(true);
	});

	it("an unrecognized VITEST_AGENT_PERSIST value is ignored with one stderr line", async () => {
		vi.stubEnv("VITEST_AGENT_PERSIST", "maybe");
		const plugin = AgentPlugin({ persist: false }, EnvironmentDetectorTest.layer("agent-shell"));
		const vitest = mockVitest(true);
		await callConfigureVitest(plugin, vitest);

		const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
		expect(reporter.resolvedConfig.persist).toBe(false);
		const stderrText = stderrWrite.mock.calls.map((c: unknown[]) => String(c[0])).join("");
		expect(stderrText).toContain("ignoring VITEST_AGENT_PERSIST=maybe");
	});

	it("CI=true alone never turns persistence off", async () => {
		vi.stubEnv("CI", "true");
		const plugin = AgentPlugin({}, EnvironmentDetectorTest.layer("ci-github"));
		const vitest = mockVitest(true);
		await callConfigureVitest(plugin, vitest);

		const reporter = vitest.config.reporters.find((r) => r instanceof AgentReporter) as AgentReporter;
		expect(reporter.resolvedConfig.persist).toBe(true);
	});
});
