import { describe, expect, it } from "vitest";
import type { TestClassification, VitestTestCase, VitestTestModule, VitestTestSuite } from "vitest-agent-sdk";
import type { RunEvent, SynthesizedCoverage } from "../src/index.js";
import { reduceRenderStateAll, renderAgent, synthesizeRunEvents } from "../src/index.js";

// ── Fixture helpers ──────────────────────────────────────────────────

interface FakeTestSpec {
	readonly name: string;
	readonly state: "passed" | "failed" | "skipped" | "pending";
	readonly duration?: number;
	readonly suite?: string;
	readonly error?: { message: string; diff?: string };
	readonly tags?: ReadonlyArray<string>;
}

interface FakeModuleSpec {
	readonly path: string;
	readonly project?: string;
	readonly duration?: number;
	readonly tests: ReadonlyArray<FakeTestSpec>;
}

const makeSuite = (name: string, parent: VitestTestSuite | VitestTestModule): VitestTestSuite => ({
	type: "suite",
	name,
	fullName: name,
	state: () => "passed",
	parent,
	options: {},
});

const makeTest = (spec: FakeTestSpec, parent: VitestTestSuite | VitestTestModule): VitestTestCase => ({
	type: "test",
	name: spec.name,
	fullName: spec.name,
	tags: spec.tags ?? [],
	parent,
	result: () =>
		spec.state === "pending"
			? undefined
			: {
					state: spec.state,
					...(spec.error !== undefined && {
						errors: [
							{
								message: spec.error.message,
								...(spec.error.diff !== undefined && { diff: spec.error.diff }),
							},
						],
					}),
				},
	diagnostic: () => ({
		duration: spec.duration ?? 0,
		flaky: false,
		slow: false,
	}),
});

const makeModule = (spec: FakeModuleSpec): VitestTestModule => {
	const module: VitestTestModule = {
		type: "module",
		moduleId: spec.path,
		relativeModuleId: spec.path,
		project: { name: spec.project ?? "default" },
		state: () => "passed",
		children: {
			*allTests() {
				for (const t of spec.tests) {
					if (t.suite !== undefined) {
						const suite = makeSuite(t.suite, module);
						yield makeTest(t, suite);
					} else {
						yield makeTest(t, module);
					}
				}
			},
			*allSuites() {
				// not used by synthesize
			},
		},
		diagnostic: () => ({ duration: spec.duration ?? 0 }),
		errors: () => [],
	};
	return module;
};

// ── Cases ────────────────────────────────────────────────────────────

describe("synthesizeRunEvents — structural shape", () => {
	it("emits RunStarted, ModuleQueued per module, then per-test pairs, then RunFinished", () => {
		const modules = [
			makeModule({
				path: "a.test.ts",
				duration: 10,
				tests: [{ name: "passes", state: "passed", duration: 4 }],
			}),
		];

		const events = synthesizeRunEvents(modules, { runId: "r", startedAt: "T0" });
		const tags = events.map((e) => e._tag);

		expect(tags[0]).toBe("RunStarted");
		expect(tags[1]).toBe("ModuleQueued");
		expect(tags.at(-1)).toBe("RunFinished");
		expect(tags).toContain("ModuleStarted");
		expect(tags).toContain("TestStarted");
		expect(tags).toContain("TestFinished");
		expect(tags).toContain("ModuleFinished");
	});

	it("respects iteration order — queues all modules before any starts", () => {
		const modules = [makeModule({ path: "a.test.ts", tests: [] }), makeModule({ path: "b.test.ts", tests: [] })];
		const events = synthesizeRunEvents(modules);
		const queuedIndices = events.flatMap((e, i) => (e._tag === "ModuleQueued" ? [i] : []));
		const startedIndices = events.flatMap((e, i) => (e._tag === "ModuleStarted" ? [i] : []));
		expect(queuedIndices).toHaveLength(2);
		expect(startedIndices).toHaveLength(2);
		expect(Math.max(...queuedIndices)).toBeLessThan(Math.min(...startedIndices));
	});
});

describe("synthesizeRunEvents — counts and totals", () => {
	it("tallies pass/fail/skip into ModuleFinished and RunFinished", () => {
		const modules = [
			makeModule({
				path: "math.test.ts",
				duration: 15,
				tests: [
					{ name: "adds", state: "passed", duration: 3 },
					{ name: "divides", state: "failed", duration: 7, error: { message: "boom" } },
					{ name: "subtracts", state: "skipped" },
				],
			}),
		];
		const events = synthesizeRunEvents(modules, { runId: "r", startedAt: "T0", finishedAt: "T1" });
		const moduleFinished = events.find((e) => e._tag === "ModuleFinished");
		const runFinished = events.find((e) => e._tag === "RunFinished");

		expect(moduleFinished).toMatchObject({
			passCount: 1,
			failCount: 1,
			skipCount: 1,
			durationMs: 15,
		});
		expect(runFinished).toMatchObject({
			passCount: 1,
			failCount: 1,
			skipCount: 1,
			durationMs: 15,
		});
	});

	it("carries per-test error details onto TestFinished", () => {
		const modules = [
			makeModule({
				path: "a.test.ts",
				tests: [
					{
						name: "fails",
						state: "failed",
						duration: 5,
						error: { message: "expected x to equal y", diff: "- x\n+ y" },
					},
				],
			}),
		];
		const [finished] = synthesizeRunEvents(modules).filter((e) => e._tag === "TestFinished");
		expect(finished).toMatchObject({
			status: "failed",
			error: { message: "expected x to equal y", diff: "- x\n+ y" },
		});
	});
});

describe("synthesizeRunEvents — suite path", () => {
	it("walks the parent chain to build suitePath", () => {
		const modules = [
			makeModule({
				path: "math.test.ts",
				tests: [{ name: "adds", state: "passed", suite: "math" }],
			}),
		];
		const events = synthesizeRunEvents(modules);
		const started = events.find((e) => e._tag === "TestStarted");
		expect(started).toMatchObject({ testName: "adds", suitePath: ["math"] });
	});
});

describe("synthesizeRunEvents — classifications and actions", () => {
	it("emits FailureClassified for failed tests with a classification entry", () => {
		const modules = [
			makeModule({
				path: "a.test.ts",
				tests: [{ name: "broken", state: "failed", error: { message: "no" } }],
			}),
		];
		const classifications = new Map<string, TestClassification>([["broken", "new-failure"]]);
		const events = synthesizeRunEvents(modules, { classifications });
		const classified = events.find((e) => e._tag === "FailureClassified");
		expect(classified).toMatchObject({
			modulePath: "a.test.ts",
			testName: "broken",
			classification: "new-failure",
		});
	});

	it("omits FailureClassified when there is no matching entry", () => {
		const modules = [
			makeModule({
				path: "a.test.ts",
				tests: [{ name: "passes", state: "passed" }],
			}),
		];
		const events = synthesizeRunEvents(modules);
		expect(events.some((e) => e._tag === "FailureClassified")).toBe(false);
	});

	it("appends SuggestedAction events before RunFinished", () => {
		const events = synthesizeRunEvents([], {
			suggestedActions: [{ severity: "warn", title: "look here", detail: "details", targetTool: "run_tests" }],
		});
		const tags = events.map((e) => e._tag);
		const actionIdx = tags.indexOf("SuggestedAction");
		const finishedIdx = tags.indexOf("RunFinished");
		expect(actionIdx).toBeGreaterThan(0);
		expect(actionIdx).toBeLessThan(finishedIdx);
	});
});

describe("synthesizeRunEvents — coverage", () => {
	const coverage: SynthesizedCoverage = {
		metrics: { lines: 70, branches: 60, functions: 80, statements: 72 },
		thresholds: { lines: 80, branches: 80 },
		gaps: [
			{
				file: "src/parser.ts",
				missing: { lines: 30, branches: 40, functions: 0, statements: 30 },
				uncoveredLines: "12-18",
			},
		],
		violations: [
			{ metric: "lines", expected: 80, actual: 70 },
			{ metric: "branches", expected: 80, actual: 60 },
		],
	};

	it("emits CoverageReady then ThresholdViolation per violation", () => {
		const events = synthesizeRunEvents([], { coverage });
		const ready = events.findIndex((e) => e._tag === "CoverageReady");
		const violations = events.map((e, i) => (e._tag === "ThresholdViolation" ? i : -1)).filter((i) => i >= 0);
		expect(ready).toBeGreaterThan(0);
		expect(violations).toHaveLength(2);
		expect(violations.every((i) => i > ready)).toBe(true);
	});
});

describe("synthesizeRunEvents — end-to-end with reducer + renderer", () => {
	it("a synthesized stream folds through the reducer into a coherent render", () => {
		const modules = [
			makeModule({
				path: "src/math.test.ts",
				duration: 14,
				tests: [
					{ name: "adds", state: "passed", duration: 3, suite: "math" },
					{
						name: "divides",
						state: "failed",
						duration: 7,
						suite: "math",
						error: { message: "expected x to equal y", diff: "- x\n+ y" },
					},
				],
			}),
			makeModule({
				path: "src/strings.test.ts",
				duration: 5,
				tests: [
					{ name: "trims", state: "passed", duration: 2, suite: "strings" },
					{ name: "slugifies", state: "skipped", suite: "strings" },
				],
			}),
		];
		const classifications = new Map<string, TestClassification>([["divides", "new-failure"]]);

		const events = synthesizeRunEvents(modules, {
			runId: "r",
			startedAt: "T0",
			finishedAt: "T1",
			classifications,
			suggestedActions: [
				{
					severity: "warn",
					title: "Investigate floating-point comparison",
					detail: "Use Number.EPSILON instead of strict equality",
				},
			],
		});

		const state = reduceRenderStateAll(events);
		expect(state.phase).toBe("finished");
		expect(state.totals).toEqual({ passCount: 2, failCount: 1, skipCount: 1, timeoutCount: 0, durationMs: 19 });
		expect(state.failures).toHaveLength(1);
		expect(state.failures[0]).toMatchObject({
			modulePath: "src/math.test.ts",
			testName: "divides",
			classification: "new-failure",
		});

		const output = renderAgent(state);
		expect(output).toContain("Tests: 2/4 passed, 1 failed, 1 skipped (19ms)");
		expect(output).toContain("Failures:");
		expect(output).toContain("[new-failure]");
		expect(output).toContain("Investigate floating-point comparison");
	});

	it("synthesized events round-trip through PubSub without losing fidelity", () => {
		const modules = [
			makeModule({
				path: "src/a.test.ts",
				duration: 4,
				tests: [{ name: "passes", state: "passed", duration: 4 }],
			}),
		];
		const events: RunEvent[] = synthesizeRunEvents(modules);
		const viaSync = reduceRenderStateAll(events);
		expect(viaSync.phase).toBe("finished");
		expect(viaSync.totals.passCount).toBe(1);
		expect(viaSync.totals.failCount).toBe(0);
	});
});

describe("synthesizeRunEvents — timeout detection", () => {
	it("sets timedOut: true on TestFinished for a Vitest timeout error", () => {
		const modules = [
			makeModule({
				path: "slow.test.ts",
				tests: [
					{
						name: "waits forever",
						state: "failed",
						error: { message: "Test timed out in 5000ms." },
					},
				],
			}),
		];
		const events = synthesizeRunEvents(modules);
		const finished = events.find((e) => e._tag === "TestFinished");
		expect(finished).toMatchObject({ timedOut: true });
	});

	it("sets ModuleFinished.timeoutCount > 0 when a test timed out", () => {
		const modules = [
			makeModule({
				path: "slow.test.ts",
				tests: [
					{
						name: "waits forever",
						state: "failed",
						error: { message: "Test timed out in 5000ms." },
					},
					{ name: "passes", state: "passed" },
				],
			}),
		];
		const events = synthesizeRunEvents(modules);
		const moduleFinished = events.find((e) => e._tag === "ModuleFinished");
		// The timed-out test counts in timeoutCount only — failCount excludes
		// it (mirroring the live reporter), so a `✗0 ⧖1` split, not `✗1 ⧖1`.
		expect(moduleFinished).toMatchObject({ timeoutCount: 1, failCount: 0, passCount: 1 });
	});

	it("sets RunFinished.timeoutCount when any test timed out", () => {
		const modules = [
			makeModule({
				path: "slow.test.ts",
				tests: [{ name: "waits forever", state: "failed", error: { message: "Test timed out in 10000ms." } }],
			}),
		];
		const events = synthesizeRunEvents(modules);
		const runFinished = events.find((e) => e._tag === "RunFinished");
		expect(runFinished).toMatchObject({ timeoutCount: 1 });
	});

	it("does not set timedOut on ordinary assertion failures", () => {
		const modules = [
			makeModule({
				path: "math.test.ts",
				tests: [{ name: "adds", state: "failed", error: { message: "expected 1 to equal 2" } }],
			}),
		];
		const events = synthesizeRunEvents(modules);
		const finished = events.find((e) => e._tag === "TestFinished");
		expect(finished).not.toMatchObject({ timedOut: true });
		const moduleFinished = events.find((e) => e._tag === "ModuleFinished");
		expect(moduleFinished).not.toMatchObject({ timeoutCount: expect.any(Number) });
	});
});

describe("synthesizeRunEvents — tagCounts", () => {
	it("aggregates per-tag counts onto ModuleFinished", () => {
		const modules = [
			makeModule({
				path: "tagged.test.ts",
				tests: [
					{ name: "a", state: "passed", tags: ["unit"] },
					{ name: "b", state: "passed", tags: ["unit"] },
					{ name: "c", state: "passed", tags: ["int"] },
				],
			}),
		];
		const events = synthesizeRunEvents(modules);
		const moduleFinished = events.find((e) => e._tag === "ModuleFinished");
		expect(moduleFinished).toMatchObject({ tagCounts: { unit: 2, int: 1 } });
	});

	it("omits tagCounts from ModuleFinished when no tests have tags", () => {
		const modules = [
			makeModule({
				path: "untagged.test.ts",
				tests: [{ name: "a", state: "passed" }],
			}),
		];
		const events = synthesizeRunEvents(modules);
		const moduleFinished = events.find((e) => e._tag === "ModuleFinished");
		expect(moduleFinished).not.toHaveProperty("tagCounts");
	});
});
