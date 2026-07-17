/**
 * vitest-agent-sdk
 *
 * Tests for buildAgentReport().
 */

import { describe, expect, it } from "vitest";
import type { VitestTestCase, VitestTestModule } from "../src/utils/build-report.js";
import { buildAgentReport, countSuiteFailures } from "../src/utils/build-report.js";

// --- Test Helpers ---

function makeTestCase(
	overrides: Partial<{
		name: string;
		fullName: string;
		state: string;
		duration: number;
		flaky: boolean;
		slow: boolean;
		errors: Array<{ message: string; diff?: string; stacks?: string[] }>;
		/** When true, result() and diagnostic() return undefined (simulates pending/skipped tests) */
		noDiagnostic: boolean;
	}> = {},
): VitestTestCase {
	const name = overrides.name ?? "my test";
	return {
		type: "test",
		name,
		fullName: overrides.fullName ?? name,
		tags: [],
		result: () => {
			if (overrides.noDiagnostic) return undefined as never;
			const res: { state: string; errors?: ReadonlyArray<{ message: string; diff?: string; stacks?: string[] }> } = {
				state: overrides.state ?? "passed",
			};
			if (overrides.errors != null) res.errors = overrides.errors;
			return res;
		},
		diagnostic: () => {
			if (overrides.noDiagnostic) return undefined as never;
			return {
				duration: overrides.duration ?? 10,
				flaky: overrides.flaky ?? false,
				slow: overrides.slow ?? false,
			};
		},
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
		/** When true, diagnostic() returns undefined */
		noDiagnostic: boolean;
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
		diagnostic: () => {
			if (overrides.noDiagnostic) return undefined as never;
			return { duration: overrides.duration ?? 50 };
		},
		errors: () => overrides.errors ?? [],
	};
}

// --- Tests ---

describe("buildAgentReport", () => {
	it("builds a passing report when all tests pass", () => {
		const modules = [
			makeTestModule({
				relativeModuleId: "src/foo.test.ts",
				state: "passed",
				duration: 100,
				tests: [
					makeTestCase({ name: "test one", state: "passed", duration: 30 }),
					makeTestCase({ name: "test two", state: "passed", duration: 70 }),
				],
			}),
		];

		const report = buildAgentReport(modules, [], "passed", { omitPassingTests: true });

		expect(report.reason).toBe("passed");
		expect(report.summary.total).toBe(2);
		expect(report.summary.passed).toBe(2);
		expect(report.summary.failed).toBe(0);
		expect(report.summary.skipped).toBe(0);
		expect(report.summary.duration).toBe(100);
		expect(report.failed).toHaveLength(0);
		expect(report.failedFiles).toHaveLength(0);
		expect(report.unhandledErrors).toHaveLength(0);
		expect(report.project).toBeUndefined();
		expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it("sets project name when provided", () => {
		const report = buildAgentReport([], [], "passed", { omitPassingTests: true }, "my-project");
		expect(report.project).toBe("my-project");
	});

	it("omits project field when projectName is undefined", () => {
		const report = buildAgentReport([], [], "passed", { omitPassingTests: true });
		expect(Object.hasOwn(report, "project")).toBe(false);
	});

	it("builds a failing report with error details and diffs", () => {
		const failingTest = makeTestCase({
			name: "should compute sum",
			fullName: "Math > should compute sum",
			state: "failed",
			duration: 15,
			errors: [
				{
					message: "expected 3 to equal 4",
					diff: "- 3\n+ 4",
					stacks: ["at Object.<anonymous> (src/math.test.ts:10:5)"],
				},
			],
		});

		const passingTest = makeTestCase({ name: "should negate", state: "passed", duration: 5 });

		const modules = [
			makeTestModule({
				relativeModuleId: "src/math.test.ts",
				state: "failed",
				duration: 20,
				tests: [failingTest, passingTest],
			}),
		];

		const report = buildAgentReport(modules, [], "failed", { omitPassingTests: true });

		expect(report.reason).toBe("failed");
		expect(report.summary.total).toBe(2);
		expect(report.summary.passed).toBe(1);
		expect(report.summary.failed).toBe(1);
		expect(report.failed).toHaveLength(1);
		expect(report.failedFiles).toEqual(["src/math.test.ts"]);

		const moduleReport = report.failed[0];
		expect(moduleReport.file).toBe("src/math.test.ts");
		expect(moduleReport.state).toBe("failed");
		expect(moduleReport.duration).toBe(20);

		// With omitPassingTests: true, only the failing test appears
		expect(moduleReport.tests).toHaveLength(1);
		const testReport = moduleReport.tests[0];
		expect(testReport.name).toBe("should compute sum");
		expect(testReport.fullName).toBe("Math > should compute sum");
		expect(testReport.state).toBe("failed");
		expect(testReport.duration).toBe(15);
		expect(testReport.errors).toHaveLength(1);
		expect(testReport.errors?.[0].message).toBe("expected 3 to equal 4");
		expect(testReport.errors?.[0].diff).toBe("- 3\n+ 4");
		expect(testReport.errors?.[0].stack).toBe("at Object.<anonymous> (src/math.test.ts:10:5)");
	});

	it("includes passing tests when omitPassingTests is false", () => {
		const passingTest = makeTestCase({ name: "passes", state: "passed" });
		const failingTest = makeTestCase({
			name: "fails",
			state: "failed",
			errors: [{ message: "boom" }],
		});

		const modules = [
			makeTestModule({
				relativeModuleId: "src/bar.test.ts",
				state: "failed",
				tests: [passingTest, failingTest],
			}),
		];

		const report = buildAgentReport(modules, [], "failed", { omitPassingTests: false });

		const moduleReport = report.failed[0];
		expect(moduleReport.tests).toHaveLength(2);
		const names = moduleReport.tests.map((t) => t.name);
		expect(names).toContain("passes");
		expect(names).toContain("fails");
	});

	it("defaults omitPassingTests to true when option is undefined", () => {
		const passingTest = makeTestCase({ name: "passes", state: "passed" });
		const failingTest = makeTestCase({
			name: "fails",
			state: "failed",
			errors: [{ message: "oops" }],
		});

		const modules = [
			makeTestModule({
				relativeModuleId: "src/baz.test.ts",
				state: "failed",
				tests: [passingTest, failingTest],
			}),
		];

		// omitPassingTests not set -- should default to true
		const report = buildAgentReport(modules, [], "failed", {});

		const moduleReport = report.failed[0];
		expect(moduleReport.tests).toHaveLength(1);
		expect(moduleReport.tests[0].name).toBe("fails");
	});

	it("marks flaky and slow tests", () => {
		const flakyTest = makeTestCase({ name: "flaky one", state: "passed", flaky: true });
		const slowTest = makeTestCase({ name: "slow one", state: "failed", slow: true, errors: [{ message: "err" }] });

		const modules = [
			makeTestModule({
				relativeModuleId: "src/edge.test.ts",
				state: "failed",
				tests: [flakyTest, slowTest],
			}),
		];

		const report = buildAgentReport(modules, [], "failed", { omitPassingTests: false });

		const moduleReport = report.failed[0];
		const flakyReport = moduleReport.tests.find((t) => t.name === "flaky one");
		const slowReport = moduleReport.tests.find((t) => t.name === "slow one");

		expect(flakyReport?.flaky).toBe(true);
		expect(slowReport?.slow).toBe(true);
	});

	it("maps multiple stacks to a single newline-joined stack string", () => {
		const test = makeTestCase({
			name: "multi-stack",
			state: "failed",
			errors: [
				{
					message: "error msg",
					stacks: ["frame one", "frame two", "frame three"],
				},
			],
		});

		const modules = [makeTestModule({ relativeModuleId: "src/s.test.ts", state: "failed", tests: [test] })];
		const report = buildAgentReport(modules, [], "failed", { omitPassingTests: true });

		const err = report.failed[0].tests[0].errors?.[0];
		expect(err?.stack).toBe("frame one\nframe two\nframe three");
	});

	it("formats Vitest ParsedStack frames into 'at <method> (<file>:<line>:<column>)' strings", () => {
		// Vitest 4 returns TestError.stacks as ParsedStack[] (objects), not string[].
		// Without correct serialization, .join("\n") produces "[object Object]" which
		// is what end-users saw in run_tests format=json output.
		const test = makeTestCase({
			name: "parsed-stack-failure",
			state: "failed",
			errors: [
				{
					message: "expected 2 to be 3",
					stacks: [
						{ method: "anonymous", file: "src/math.test.ts", line: 10, column: 5 },
						{ method: "Module._compile", file: "node:internal/modules/cjs/loader", line: 100, column: 12 },
						// biome-ignore lint/suspicious/noExplicitAny: simulates Vitest ParsedStack runtime shape
					] as any,
				},
			],
		});

		const modules = [makeTestModule({ relativeModuleId: "src/m.test.ts", state: "failed", tests: [test] })];
		const report = buildAgentReport(modules, [], "failed", { omitPassingTests: true });

		const err = report.failed[0].tests[0].errors?.[0];
		expect(err?.stack).toBe(
			"at anonymous (src/math.test.ts:10:5)\nat Module._compile (node:internal/modules/cjs/loader:100:12)",
		);
	});

	it("falls back to '<anonymous>' when ParsedStack.method is empty", () => {
		const test = makeTestCase({
			name: "no-method",
			state: "failed",
			errors: [
				{
					message: "boom",
					// biome-ignore lint/suspicious/noExplicitAny: simulates runtime ParsedStack
					stacks: [{ method: "", file: "src/x.ts", line: 1, column: 2 }] as any,
				},
			],
		});

		const modules = [makeTestModule({ relativeModuleId: "src/x.test.ts", state: "failed", tests: [test] })];
		const report = buildAgentReport(modules, [], "failed", { omitPassingTests: true });

		const err = report.failed[0].tests[0].errors?.[0];
		expect(err?.stack).toBe("at <anonymous> (src/x.ts:1:2)");
	});

	it("handles mixed string and ParsedStack entries in stacks array", () => {
		const test = makeTestCase({
			name: "mixed",
			state: "failed",
			errors: [
				{
					message: "msg",
					// biome-ignore lint/suspicious/noExplicitAny: simulates union runtime shape
					stacks: ["raw frame string", { method: "fn", file: "f.ts", line: 3, column: 4 }] as any,
				},
			],
		});

		const modules = [makeTestModule({ relativeModuleId: "src/m.test.ts", state: "failed", tests: [test] })];
		const report = buildAgentReport(modules, [], "failed", { omitPassingTests: true });

		const err = report.failed[0].tests[0].errors?.[0];
		expect(err?.stack).toBe("raw frame string\nat fn (f.ts:3:4)");
	});

	it("captures unhandled errors", () => {
		const report = buildAgentReport([], [{ message: "global crash", stacks: ["at top-level"] }], "interrupted", {
			omitPassingTests: true,
		});

		expect(report.reason).toBe("interrupted");
		expect(report.unhandledErrors).toHaveLength(1);
		expect(report.unhandledErrors[0].message).toBe("global crash");
		expect(report.unhandledErrors[0].stack).toBe("at top-level");
	});

	it("accumulates duration across multiple modules", () => {
		const modules = [
			makeTestModule({ relativeModuleId: "src/a.test.ts", duration: 100, tests: [makeTestCase()] }),
			makeTestModule({ relativeModuleId: "src/b.test.ts", duration: 200, tests: [makeTestCase()] }),
			makeTestModule({ relativeModuleId: "src/c.test.ts", duration: 300, tests: [makeTestCase()] }),
		];

		const report = buildAgentReport(modules, [], "passed", { omitPassingTests: true });

		expect(report.summary.duration).toBe(600);
		expect(report.summary.total).toBe(3);
	});

	it("handles pending test state as skipped in summary", () => {
		const pendingTest = makeTestCase({ name: "pending test", state: "pending" });

		const modules = [
			makeTestModule({
				relativeModuleId: "src/pending.test.ts",
				state: "passed",
				tests: [pendingTest, makeTestCase({ name: "passing", state: "passed" })],
			}),
		];

		const report = buildAgentReport(modules, [], "passed", { omitPassingTests: false });

		expect(report.summary.total).toBe(2);
		expect(report.summary.passed).toBe(1);
		expect(report.summary.skipped).toBe(1);
		expect(report.summary.failed).toBe(0);

		// Pending tests don't cause module failure, so failed array should be empty
		expect(report.failed).toHaveLength(0);
	});

	it("normalizes unknown state to pending", () => {
		const unknownStateTest = makeTestCase({ name: "unknown", state: "some-unknown-state" });

		const modules = [
			makeTestModule({
				relativeModuleId: "src/unknown.test.ts",
				state: "passed",
				tests: [unknownStateTest],
			}),
		];

		const report = buildAgentReport(modules, [], "passed", { omitPassingTests: false });

		// Unknown states fall through to skipped count via pending path
		expect(report.summary.skipped).toBe(1);
		expect(report.summary.passed).toBe(0);
		expect(report.summary.failed).toBe(0);
	});

	it("includes module-level errors in the module report", () => {
		const modules = [
			makeTestModule({
				relativeModuleId: "src/broken.test.ts",
				state: "failed",
				tests: [makeTestCase({ state: "failed", errors: [{ message: "test err" }] })],
				errors: [{ message: "module syntax error", stacks: ["at parse"] }],
			}),
		];

		const report = buildAgentReport(modules, [], "failed", { omitPassingTests: true });

		const moduleReport = report.failed[0];
		expect(moduleReport.errors).toHaveLength(1);
		expect(moduleReport.errors?.[0].message).toBe("module syntax error");
		expect(moduleReport.errors?.[0].stack).toBe("at parse");
	});

	it("surfaces collection-failed modules with zero tests in failed[] and failedFiles", () => {
		// Vitest's shape for a test file that fails to import:
		// state() === "failed", allTests() yields nothing, errors() carries
		// the import-time exception. Without special-casing, the module
		// would be silently dropped from `failed` because `moduleHasFailure`
		// only flips on a failed test case, leaving the agent with a
		// misleading "0 passed" report.
		const modules = [
			makeTestModule({
				relativeModuleId: "playground/__test__/text-utils.test.ts",
				state: "failed",
				tests: [],
				errors: [
					{
						message: "Cannot find module '../src/text-utils.js'",
						stacks: ["at playground/__test__/text-utils.test.ts:2:1"],
					},
				],
			}),
		];

		const report = buildAgentReport(modules, [], "failed", { omitPassingTests: true });

		expect(report.failedFiles).toEqual(["playground/__test__/text-utils.test.ts"]);
		expect(report.failed).toHaveLength(1);
		expect(report.failed[0].errors?.[0].message).toBe("Cannot find module '../src/text-utils.js'");
		// Test counts stay tied to test cases — collection failures don't
		// fabricate a synthetic failed test count.
		expect(report.summary.total).toBe(0);
		expect(report.summary.failed).toBe(0);
		// ...but the suite-level failure IS counted separately so renderers
		// and the health check can surface it without inflating summary.failed.
		expect(countSuiteFailures(report)).toBe(1);
	});

	describe("countSuiteFailures", () => {
		it("returns 0 when every failed module has a failed test case", () => {
			const modules = [
				makeTestModule({
					relativeModuleId: "src/a.test.ts",
					state: "failed",
					tests: [makeTestCase({ name: "boom", state: "failed", errors: [{ message: "x" }] })],
				}),
			];
			const report = buildAgentReport(modules, [], "failed", { omitPassingTests: true });
			expect(report.summary.failed).toBe(1);
			expect(countSuiteFailures(report)).toBe(0);
		});

		it("counts a collection-failed module (zero tests, module errors) as a suite failure", () => {
			const modules = [
				makeTestModule({
					relativeModuleId: "src/broken.test.ts",
					state: "failed",
					tests: [],
					errors: [{ message: "Cannot find package 'better-sqlite3'" }],
				}),
			];
			const report = buildAgentReport(modules, [], "failed", { omitPassingTests: true });
			expect(countSuiteFailures(report)).toBe(1);
		});

		it("counts only the suite-level failures in a mixed report", () => {
			const modules = [
				makeTestModule({
					relativeModuleId: "src/passes.test.ts",
					state: "passed",
					tests: [makeTestCase({ name: "ok", state: "passed" })],
				}),
				makeTestModule({
					relativeModuleId: "src/test-fails.test.ts",
					state: "failed",
					tests: [makeTestCase({ name: "bad", state: "failed", errors: [{ message: "y" }] })],
				}),
				makeTestModule({
					relativeModuleId: "src/wont-load.test.ts",
					state: "failed",
					tests: [],
					errors: [{ message: "import error" }],
				}),
			];
			const report = buildAgentReport(modules, [], "failed", { omitPassingTests: true });
			expect(report.summary.failed).toBe(1); // one failed test case
			expect(countSuiteFailures(report)).toBe(1); // one suite that never loaded
		});
	});

	it("handles tests where diagnostic() returns undefined (skipped/todo)", () => {
		const skippedTest = makeTestCase({ name: "skipped test", state: "skipped", noDiagnostic: true });
		const passingTest = makeTestCase({ name: "passing test", state: "passed", duration: 20 });

		const modules = [
			makeTestModule({
				relativeModuleId: "src/skip.test.ts",
				state: "passed",
				tests: [skippedTest, passingTest],
			}),
		];

		const report = buildAgentReport(modules, [], "passed", { omitPassingTests: false });

		expect(report.summary.total).toBe(2);
		expect(report.summary.passed).toBe(1);
		expect(report.summary.skipped).toBe(1);
	});

	it("handles tests where result() returns undefined (pending/collected)", () => {
		const pendingTest = makeTestCase({ name: "pending test", noDiagnostic: true });
		const passingTest = makeTestCase({ name: "passing test", state: "passed", duration: 20 });

		const modules = [
			makeTestModule({
				relativeModuleId: "src/pending.test.ts",
				state: "passed",
				tests: [pendingTest, passingTest],
			}),
		];

		const report = buildAgentReport(modules, [], "passed", { omitPassingTests: false });

		expect(report.summary.total).toBe(2);
		expect(report.summary.passed).toBe(1);
		// pending (undefined result) normalizes to "pending" which counts as skipped
		expect(report.summary.skipped).toBe(1);

		// The pending test report should have no duration
		expect(report.failed).toHaveLength(0);
	});

	it("handles modules where diagnostic() returns undefined", () => {
		const modules = [
			makeTestModule({
				relativeModuleId: "src/a.test.ts",
				duration: 100,
				tests: [makeTestCase()],
			}),
			makeTestModule({
				relativeModuleId: "src/b.test.ts",
				noDiagnostic: true,
				tests: [makeTestCase()],
			}),
		];

		const report = buildAgentReport(modules, [], "passed", { omitPassingTests: true });

		// Module with undefined diagnostic contributes 0 to total duration
		expect(report.summary.duration).toBe(100);
		expect(report.summary.total).toBe(2);
	});
});
