/**
 * Canonical event sequences used by the reducer tests, the agent
 * renderer's golden-snapshot tests, the Ink component tests, and the
 * dispatcher matrix snapshot tests.
 *
 * The original four scenarios (allPassEvents, mixedFailEvents,
 * coverageViolationEvents, flakyRecoveryEvents) remain so the existing
 * golden tests keep their stable inputs. The matrix-specific sequences
 * (singleTestPassEvents, singleTestFailEvents, etc.) are dispatcher
 * fixtures.
 */

import type { RunEvent } from "vitest-agent-sdk";

const RUN_ID = "run-abc";
const CONFIG_HASH = "cfg-deadbeef";

// --- allPassEvents — one module, one passing test (used as single-test fixture too) ---

export const allPassEvents: ReadonlyArray<RunEvent> = [
	{ _tag: "RunStarted", runId: RUN_ID, startedAt: "2026-05-12T00:00:00.000Z", configHash: CONFIG_HASH },
	{ _tag: "ModuleQueued", modulePath: "src/math.test.ts" },
	{ _tag: "ModuleStarted", modulePath: "src/math.test.ts", startedAt: "2026-05-12T00:00:00.050Z" },
	{ _tag: "TestStarted", modulePath: "src/math.test.ts", testName: "adds", suitePath: ["math"] },
	{
		_tag: "TestFinished",
		modulePath: "src/math.test.ts",
		testName: "adds",
		suitePath: ["math"],
		status: "passed",
		durationMs: 4,
	},
	{
		_tag: "ModuleFinished",
		modulePath: "src/math.test.ts",
		passCount: 1,
		failCount: 0,
		skipCount: 0,
		durationMs: 6,
	},
	{
		_tag: "RunFinished",
		runId: RUN_ID,
		finishedAt: "2026-05-12T00:00:00.080Z",
		passCount: 1,
		failCount: 0,
		skipCount: 0,
		durationMs: 80,
	},
];

/**
 * Alias of {@link allPassEvents} for dispatcher single-test cell tests.
 * A run with one module and exactly one passing test classifies as
 * `single-test × all-pass`.
 */
export const singleTestPassEvents = allPassEvents;

/**
 * Single failing test in a single module — `single-test × some-fail`.
 */
export const singleTestFailEvents: ReadonlyArray<RunEvent> = [
	{ _tag: "RunStarted", runId: RUN_ID, startedAt: "2026-05-12T00:00:00.000Z", configHash: CONFIG_HASH },
	{ _tag: "ModuleQueued", modulePath: "src/math.test.ts" },
	{ _tag: "ModuleStarted", modulePath: "src/math.test.ts", startedAt: "2026-05-12T00:00:00.010Z" },
	{ _tag: "TestStarted", modulePath: "src/math.test.ts", testName: "divides", suitePath: ["math"] },
	{
		_tag: "TestFinished",
		modulePath: "src/math.test.ts",
		testName: "divides",
		suitePath: ["math"],
		status: "failed",
		durationMs: 7,
		error: {
			message: "expected 0.5 to equal 0.5000001",
			stack: "AssertionError\n    at src/math.test.ts:12:5",
			diff: "- 0.5000001\n+ 0.5",
		},
	},
	{
		_tag: "ModuleFinished",
		modulePath: "src/math.test.ts",
		passCount: 0,
		failCount: 1,
		skipCount: 0,
		durationMs: 7,
	},
	{
		_tag: "FailureClassified",
		modulePath: "src/math.test.ts",
		testName: "divides",
		classification: "new-failure",
	},
	{
		_tag: "RunFinished",
		runId: RUN_ID,
		finishedAt: "2026-05-12T00:00:00.030Z",
		passCount: 0,
		failCount: 1,
		skipCount: 0,
		durationMs: 30,
	},
];

/**
 * Single module with multiple passing tests — `single-file × all-pass`.
 */
export const singleFileMultiTestPassEvents: ReadonlyArray<RunEvent> = [
	{ _tag: "RunStarted", runId: RUN_ID, startedAt: "2026-05-12T00:00:00.000Z", configHash: CONFIG_HASH },
	{ _tag: "ModuleQueued", modulePath: "src/math.test.ts" },
	{ _tag: "ModuleStarted", modulePath: "src/math.test.ts", startedAt: "2026-05-12T00:00:00.010Z" },
	{ _tag: "TestStarted", modulePath: "src/math.test.ts", testName: "adds", suitePath: ["math"] },
	{
		_tag: "TestFinished",
		modulePath: "src/math.test.ts",
		testName: "adds",
		suitePath: ["math"],
		status: "passed",
		durationMs: 2,
	},
	{ _tag: "TestStarted", modulePath: "src/math.test.ts", testName: "subtracts", suitePath: ["math"] },
	{
		_tag: "TestFinished",
		modulePath: "src/math.test.ts",
		testName: "subtracts",
		suitePath: ["math"],
		status: "passed",
		durationMs: 3,
	},
	{ _tag: "TestStarted", modulePath: "src/math.test.ts", testName: "multiplies", suitePath: ["math"] },
	{
		_tag: "TestFinished",
		modulePath: "src/math.test.ts",
		testName: "multiplies",
		suitePath: ["math"],
		status: "passed",
		durationMs: 4,
	},
	{
		_tag: "ModuleFinished",
		modulePath: "src/math.test.ts",
		passCount: 3,
		failCount: 0,
		skipCount: 0,
		durationMs: 12,
	},
	{
		_tag: "RunFinished",
		runId: RUN_ID,
		finishedAt: "2026-05-12T00:00:00.050Z",
		passCount: 3,
		failCount: 0,
		skipCount: 0,
		durationMs: 50,
	},
];

/**
 * Single module with passing tests plus a threshold violation —
 * `single-file × threshold-violation`.
 */
export const singleFileThresholdEvents: ReadonlyArray<RunEvent> = [
	...singleFileMultiTestPassEvents.slice(0, -1),
	{
		_tag: "CoverageReady",
		metrics: { lines: 72.5, branches: 60, functions: 85, statements: 72 },
		thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
		gaps: [
			{
				file: "src/math.ts",
				missing: { lines: 30, branches: 40, functions: 0, statements: 30 },
				uncoveredLines: "12-18",
			},
		],
	},
	{ _tag: "ThresholdViolation", metric: "lines", expected: 80, actual: 72.5 },
	{ _tag: "ThresholdViolation", metric: "branches", expected: 80, actual: 60 },
	{
		_tag: "RunFinished",
		runId: RUN_ID,
		finishedAt: "2026-05-12T00:00:00.050Z",
		passCount: 3,
		failCount: 0,
		skipCount: 0,
		durationMs: 50,
	},
];

// --- mixedFailEvents — two modules, one passing and one failing each (single-project × some-fail) ---

export const mixedFailEvents: ReadonlyArray<RunEvent> = [
	{ _tag: "RunStarted", runId: RUN_ID, startedAt: "2026-05-12T00:00:00.000Z", configHash: CONFIG_HASH },
	{ _tag: "ModuleQueued", modulePath: "src/math.test.ts" },
	{ _tag: "ModuleQueued", modulePath: "src/strings.test.ts" },
	{ _tag: "ModuleStarted", modulePath: "src/math.test.ts", startedAt: "2026-05-12T00:00:00.010Z" },
	{ _tag: "TestStarted", modulePath: "src/math.test.ts", testName: "adds", suitePath: ["math"] },
	{
		_tag: "TestFinished",
		modulePath: "src/math.test.ts",
		testName: "adds",
		suitePath: ["math"],
		status: "passed",
		durationMs: 3,
	},
	{ _tag: "TestStarted", modulePath: "src/math.test.ts", testName: "divides", suitePath: ["math"] },
	{
		_tag: "TestFinished",
		modulePath: "src/math.test.ts",
		testName: "divides",
		suitePath: ["math"],
		status: "failed",
		durationMs: 7,
		error: {
			message: "expected 0.5 to equal 0.5000001",
			stack: "AssertionError\n    at src/math.test.ts:12:5",
			diff: "- 0.5000001\n+ 0.5",
		},
	},
	{
		_tag: "ModuleFinished",
		modulePath: "src/math.test.ts",
		passCount: 1,
		failCount: 1,
		skipCount: 0,
		durationMs: 14,
	},
	{ _tag: "ModuleStarted", modulePath: "src/strings.test.ts", startedAt: "2026-05-12T00:00:00.020Z" },
	{ _tag: "TestStarted", modulePath: "src/strings.test.ts", testName: "trims", suitePath: ["strings"] },
	{
		_tag: "TestFinished",
		modulePath: "src/strings.test.ts",
		testName: "trims",
		suitePath: ["strings"],
		status: "passed",
		durationMs: 2,
	},
	{ _tag: "TestStarted", modulePath: "src/strings.test.ts", testName: "slugifies", suitePath: ["strings"] },
	{
		_tag: "TestFinished",
		modulePath: "src/strings.test.ts",
		testName: "slugifies",
		suitePath: ["strings"],
		status: "skipped",
		durationMs: 0,
	},
	{
		_tag: "ModuleFinished",
		modulePath: "src/strings.test.ts",
		passCount: 1,
		failCount: 0,
		skipCount: 1,
		durationMs: 5,
	},
	{
		_tag: "FailureClassified",
		modulePath: "src/math.test.ts",
		testName: "divides",
		classification: "new-failure",
	},
	{
		_tag: "SuggestedAction",
		severity: "warn",
		title: "Investigate floating-point comparison",
		detail: "Use Number.EPSILON instead of strict equality for 0.5 vs 0.5000001",
	},
	{
		_tag: "RunFinished",
		runId: RUN_ID,
		finishedAt: "2026-05-12T00:00:00.100Z",
		passCount: 2,
		failCount: 1,
		skipCount: 1,
		durationMs: 100,
	},
];

/**
 * Single project with two passing modules and no failures —
 * `single-project × all-pass`.
 */
export const singleProjectAllPassEvents: ReadonlyArray<RunEvent> = [
	{ _tag: "RunStarted", runId: RUN_ID, startedAt: "2026-05-12T00:00:00.000Z", configHash: CONFIG_HASH },
	{ _tag: "ModuleQueued", modulePath: "src/math.test.ts" },
	{ _tag: "ModuleQueued", modulePath: "src/strings.test.ts" },
	{ _tag: "ModuleStarted", modulePath: "src/math.test.ts", startedAt: "2026-05-12T00:00:00.010Z" },
	{ _tag: "TestStarted", modulePath: "src/math.test.ts", testName: "adds", suitePath: ["math"] },
	{
		_tag: "TestFinished",
		modulePath: "src/math.test.ts",
		testName: "adds",
		suitePath: ["math"],
		status: "passed",
		durationMs: 3,
	},
	{
		_tag: "ModuleFinished",
		modulePath: "src/math.test.ts",
		passCount: 1,
		failCount: 0,
		skipCount: 0,
		durationMs: 5,
	},
	{ _tag: "ModuleStarted", modulePath: "src/strings.test.ts", startedAt: "2026-05-12T00:00:00.020Z" },
	{ _tag: "TestStarted", modulePath: "src/strings.test.ts", testName: "trims", suitePath: ["strings"] },
	{
		_tag: "TestFinished",
		modulePath: "src/strings.test.ts",
		testName: "trims",
		suitePath: ["strings"],
		status: "passed",
		durationMs: 2,
	},
	{
		_tag: "ModuleFinished",
		modulePath: "src/strings.test.ts",
		passCount: 1,
		failCount: 0,
		skipCount: 0,
		durationMs: 4,
	},
	{
		_tag: "RunFinished",
		runId: RUN_ID,
		finishedAt: "2026-05-12T00:00:00.090Z",
		passCount: 2,
		failCount: 0,
		skipCount: 0,
		durationMs: 90,
	},
];

// --- coverageViolationEvents ---

export const coverageViolationEvents: ReadonlyArray<RunEvent> = [
	{ _tag: "RunStarted", runId: RUN_ID, startedAt: "2026-05-12T00:00:00.000Z", configHash: CONFIG_HASH },
	{ _tag: "ModuleQueued", modulePath: "src/parser.test.ts" },
	{ _tag: "ModuleStarted", modulePath: "src/parser.test.ts", startedAt: "2026-05-12T00:00:00.010Z" },
	{ _tag: "TestStarted", modulePath: "src/parser.test.ts", testName: "parses", suitePath: ["parser"] },
	{
		_tag: "TestFinished",
		modulePath: "src/parser.test.ts",
		testName: "parses",
		suitePath: ["parser"],
		status: "passed",
		durationMs: 10,
	},
	{
		_tag: "ModuleFinished",
		modulePath: "src/parser.test.ts",
		passCount: 1,
		failCount: 0,
		skipCount: 0,
		durationMs: 12,
	},
	{
		_tag: "CoverageReady",
		metrics: { lines: 72.5, branches: 60, functions: 85, statements: 72 },
		thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
		gaps: [
			{
				file: "src/parser/edge-cases.ts",
				missing: { lines: 30, branches: 40, functions: 0, statements: 30 },
				uncoveredLines: "12-18, 22, 30-35",
			},
		],
	},
	{ _tag: "ThresholdViolation", metric: "lines", expected: 80, actual: 72.5 },
	{ _tag: "ThresholdViolation", metric: "branches", expected: 80, actual: 60 },
	{
		_tag: "SuggestedAction",
		severity: "blocker",
		title: "Coverage thresholds failing",
		detail: "lines coverage 72.5% is below threshold 80%",
	},
	{
		_tag: "RunFinished",
		runId: RUN_ID,
		finishedAt: "2026-05-12T00:00:00.050Z",
		passCount: 1,
		failCount: 0,
		skipCount: 0,
		durationMs: 50,
	},
];

/**
 * Single project, all tests passing, with multiple threshold violations
 * — `single-project × threshold-violation`. Two modules so the run is
 * not classified as single-file.
 */
export const singleProjectThresholdEvents: ReadonlyArray<RunEvent> = [
	{ _tag: "RunStarted", runId: RUN_ID, startedAt: "2026-05-12T00:00:00.000Z", configHash: CONFIG_HASH },
	{ _tag: "ModuleQueued", modulePath: "src/parser.test.ts" },
	{ _tag: "ModuleQueued", modulePath: "src/lexer.test.ts" },
	{ _tag: "ModuleStarted", modulePath: "src/parser.test.ts", startedAt: "2026-05-12T00:00:00.010Z" },
	{ _tag: "TestStarted", modulePath: "src/parser.test.ts", testName: "parses", suitePath: ["parser"] },
	{
		_tag: "TestFinished",
		modulePath: "src/parser.test.ts",
		testName: "parses",
		suitePath: ["parser"],
		status: "passed",
		durationMs: 10,
	},
	{
		_tag: "ModuleFinished",
		modulePath: "src/parser.test.ts",
		passCount: 1,
		failCount: 0,
		skipCount: 0,
		durationMs: 12,
	},
	{ _tag: "ModuleStarted", modulePath: "src/lexer.test.ts", startedAt: "2026-05-12T00:00:00.020Z" },
	{ _tag: "TestStarted", modulePath: "src/lexer.test.ts", testName: "tokenizes", suitePath: ["lexer"] },
	{
		_tag: "TestFinished",
		modulePath: "src/lexer.test.ts",
		testName: "tokenizes",
		suitePath: ["lexer"],
		status: "passed",
		durationMs: 6,
	},
	{
		_tag: "ModuleFinished",
		modulePath: "src/lexer.test.ts",
		passCount: 1,
		failCount: 0,
		skipCount: 0,
		durationMs: 8,
	},
	{
		_tag: "CoverageReady",
		metrics: { lines: 72.5, branches: 60, functions: 85, statements: 72 },
		thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
		gaps: [
			{
				file: "src/parser/edge-cases.ts",
				missing: { lines: 30, branches: 40, functions: 0, statements: 30 },
				uncoveredLines: "12-18, 22, 30-35",
			},
			{
				file: "src/lexer/unicode.ts",
				missing: { lines: 25, branches: 30, functions: 10, statements: 25 },
				uncoveredLines: "50-58",
			},
		],
	},
	{ _tag: "ThresholdViolation", metric: "lines", expected: 80, actual: 72.5 },
	{ _tag: "ThresholdViolation", metric: "branches", expected: 80, actual: 60 },
	{
		_tag: "RunFinished",
		runId: RUN_ID,
		finishedAt: "2026-05-12T00:00:00.090Z",
		passCount: 2,
		failCount: 0,
		skipCount: 0,
		durationMs: 90,
	},
];

// --- flakyRecoveryEvents ---

export const flakyRecoveryEvents: ReadonlyArray<RunEvent> = [
	{ _tag: "RunStarted", runId: RUN_ID, startedAt: "2026-05-12T00:00:00.000Z", configHash: CONFIG_HASH },
	{ _tag: "ModuleQueued", modulePath: "src/network.test.ts" },
	{ _tag: "ModuleStarted", modulePath: "src/network.test.ts", startedAt: "2026-05-12T00:00:00.010Z" },
	{ _tag: "TestStarted", modulePath: "src/network.test.ts", testName: "retries", suitePath: ["network"] },
	{
		_tag: "TestFinished",
		modulePath: "src/network.test.ts",
		testName: "retries",
		suitePath: ["network"],
		status: "failed",
		durationMs: 200,
		error: { message: "ECONNRESET", stack: "Error\n    at fetch (src/network.ts:30:11)" },
	},
	{
		_tag: "FailureClassified",
		modulePath: "src/network.test.ts",
		testName: "retries",
		classification: "flaky",
	},
	{ _tag: "TestStarted", modulePath: "src/network.test.ts", testName: "times out", suitePath: ["network"] },
	{
		_tag: "TestFinished",
		modulePath: "src/network.test.ts",
		testName: "times out",
		suitePath: ["network"],
		status: "passed",
		durationMs: 30,
	},
	{
		_tag: "FailureClassified",
		modulePath: "src/network.test.ts",
		testName: "times out",
		classification: "recovered",
	},
	{
		_tag: "ModuleFinished",
		modulePath: "src/network.test.ts",
		passCount: 1,
		failCount: 1,
		skipCount: 0,
		durationMs: 230,
	},
	{
		_tag: "SuggestedAction",
		severity: "info",
		title: "Re-run the flaky network test",
		detail: "src/network.test.ts > network > retries failed once but other transient calls recovered",
		targetTool: "run_tests",
	},
	{
		_tag: "RunFinished",
		runId: RUN_ID,
		finishedAt: "2026-05-12T00:00:00.500Z",
		passCount: 1,
		failCount: 1,
		skipCount: 0,
		durationMs: 500,
	},
];
