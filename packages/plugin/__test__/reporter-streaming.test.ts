/**
 * Tests for the streaming Vitest reporter callbacks on AgentReporter.
 * These verify the onRunEvent tap fires with correctly-shaped RunEvents
 * as the run progresses, without involving persistence or rendering.
 *
 * @packageDocumentation
 */

import type { RunEvent } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { AgentReporter } from "../src/reporter.js";

interface FakeTestSpec {
	readonly name: string;
	readonly state: "passed" | "failed" | "skipped";
	readonly duration?: number;
	readonly suite?: string;
	readonly error?: { message: string; diff?: string; expected?: unknown; actual?: unknown };
	readonly tags?: ReadonlyArray<string>;
}

const makeTestCase = (
	spec: FakeTestSpec,
	parent: { type: "module" | "suite"; name: string; parent?: unknown },
	module: { relativeModuleId: string },
) => ({
	type: "test" as const,
	name: spec.name,
	parent,
	module,
	tags: spec.tags ?? [],
	result: () =>
		spec.state === undefined
			? undefined
			: {
					state: spec.state,
					...(spec.error !== undefined && {
						errors: [
							{
								message: spec.error.message,
								...(spec.error.diff !== undefined && { diff: spec.error.diff }),
								...(spec.error.expected !== undefined && { expected: spec.error.expected }),
								...(spec.error.actual !== undefined && { actual: spec.error.actual }),
							},
						],
					}),
				},
	diagnostic: () => ({ duration: spec.duration ?? 0 }),
});

const makeTestModule = (modulePath: string, tests: ReadonlyArray<FakeTestSpec>, duration = 0) => {
	const module = {
		type: "module" as const,
		moduleId: `/abs/${modulePath}`,
		relativeModuleId: modulePath,
		project: { name: "default" },
		state: () => "passed",
		children: {
			*allTests(): Iterable<ReturnType<typeof makeTestCase>> {
				for (const spec of tests) {
					const parent =
						spec.suite !== undefined
							? { type: "suite" as const, name: spec.suite, parent: module }
							: { type: "module" as const, name: modulePath, parent: undefined };
					yield makeTestCase(spec, parent, module);
				}
			},
			*allSuites() {
				// not used
			},
		},
		diagnostic: () => ({ duration }),
		errors: () => [],
	};
	return module;
};

describe("AgentReporter streaming callbacks", () => {
	it("publishes RunStarted when onTestRunStart fires", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		expect(events).toHaveLength(1);
		expect(events[0]?._tag).toBe("RunStarted");
	});

	it("publishes ModuleQueued and ModuleStarted on the matching hooks", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		reporter.onTestModuleQueued({ relativeModuleId: "a.test.ts" });
		reporter.onTestModuleStart({ relativeModuleId: "a.test.ts" });
		const tags = events.map((e) => e._tag);
		expect(tags).toContain("ModuleQueued");
		expect(tags).toContain("ModuleStarted");
	});

	it("publishes TestStarted from onTestCaseReady and TestFinished from onTestCaseResult", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		const module = makeTestModule("a.test.ts", [{ name: "passes", state: "passed", duration: 4 }]);
		for (const test of module.children.allTests()) {
			reporter.onTestCaseReady(test);
			reporter.onTestCaseResult(test);
		}
		const tags = events.map((e) => e._tag);
		expect(tags).toContain("TestStarted");
		expect(tags).toContain("TestFinished");
		// TestStarted must land before TestFinished — `onTestCaseReady`
		// fires earlier in Vitest's lifecycle, giving the renderer a
		// frame for the transient "running" state.
		expect(tags.indexOf("TestStarted")).toBeLessThan(tags.indexOf("TestFinished"));
		// `onTestCaseResult` emits only `TestFinished` — exactly one
		// `TestStarted`, and it came from `onTestCaseReady`.
		expect(events.filter((e) => e._tag === "TestStarted")).toHaveLength(1);
		const finished = events.find((e) => e._tag === "TestFinished");
		expect(finished).toMatchObject({ status: "passed", durationMs: 4 });
	});

	it("emits only TestFinished from onTestCaseResult — no standalone TestStarted", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		const module = makeTestModule("a.test.ts", [{ name: "passes", state: "passed", duration: 4 }]);
		for (const test of module.children.allTests()) {
			reporter.onTestCaseResult(test);
		}
		const tags = events.map((e) => e._tag);
		expect(tags).toContain("TestFinished");
		expect(tags).not.toContain("TestStarted");
	});

	it("publishes ModuleFinished with tallied counts", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		const module = makeTestModule(
			"a.test.ts",
			[
				{ name: "p1", state: "passed" },
				{ name: "p2", state: "passed" },
				{ name: "f1", state: "failed", error: { message: "boom" } },
				{ name: "s1", state: "skipped" },
			],
			42,
		);
		reporter.onTestModuleEnd(module);
		const finished = events.find((e) => e._tag === "ModuleFinished");
		expect(finished).toMatchObject({
			modulePath: "a.test.ts",
			passCount: 2,
			failCount: 1,
			skipCount: 1,
			durationMs: 42,
		});
	});

	it("publishes RunFinished from onTestRunEnd with run totals", async () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		const module = makeTestModule(
			"a.test.ts",
			[
				{ name: "p1", state: "passed", duration: 2 },
				{ name: "f1", state: "failed", duration: 3 },
			],
			5,
		);
		// Silence the persistence-pipeline error that fires after RunFinished
		// is emitted — our fixture is intentionally minimal and trips deeper
		// assertions about modules. The reporter's outer try/catch logs it
		// to stderr; we only care that the event arrived first.
		const originalWrite = process.stderr.write.bind(process.stderr);
		process.stderr.write = (() => true) as typeof process.stderr.write;
		try {
			await reporter.onTestRunEnd([module] as unknown as ReadonlyArray<unknown>, [], "failed");
		} catch {
			// noop — see comment above.
		} finally {
			process.stderr.write = originalWrite;
		}
		const finished = events.find((e) => e._tag === "RunFinished");
		expect(finished).toMatchObject({
			passCount: 1,
			failCount: 1,
			skipCount: 0,
			durationMs: 5,
		});
	});

	it("captures suite path from the test parent chain", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		const module = makeTestModule("math.test.ts", [{ name: "adds", state: "passed", suite: "math" }]);
		for (const test of module.children.allTests()) {
			reporter.onTestCaseReady(test);
		}
		const started = events.find((e) => e._tag === "TestStarted");
		expect(started).toMatchObject({ testName: "adds", suitePath: ["math"] });
	});

	it("does nothing when no onRunEvent tap is configured", () => {
		const reporter = new AgentReporter({});
		// Should not throw.
		reporter.onTestRunStart([]);
		reporter.onTestModuleQueued({ relativeModuleId: "a.test.ts" });
		reporter.onTestModuleStart({ relativeModuleId: "a.test.ts" });
		const module = makeTestModule("a.test.ts", [{ name: "x", state: "passed" }]);
		for (const test of module.children.allTests()) {
			reporter.onTestCaseResult(test);
		}
		reporter.onTestModuleEnd(module);
	});

	it("threads the Vitest project name onto module events", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		reporter.onTestModuleQueued({ relativeModuleId: "a.test.ts", project: { name: "ui" } });
		reporter.onTestModuleStart({ relativeModuleId: "a.test.ts", project: { name: "ui" } });
		const queued = events.find((e) => e._tag === "ModuleQueued");
		const started = events.find((e) => e._tag === "ModuleStarted");
		expect(queued).toMatchObject({ projectName: "ui" });
		expect(started).toMatchObject({ projectName: "ui" });
	});

	it("publishes ModuleCollected with test and suite counts", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		reporter.onTestModuleCollected({
			relativeModuleId: "a.test.ts",
			children: {
				*allTests() {
					yield {};
					yield {};
				},
				*allSuites() {
					yield {};
				},
			},
		});
		expect(events.find((e) => e._tag === "ModuleCollected")).toMatchObject({
			modulePath: "a.test.ts",
			testCount: 2,
			suiteCount: 1,
		});
	});

	it("publishes SuiteStarted and SuiteFinished for a test suite", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		const suite = {
			name: "math",
			module: { relativeModuleId: "a.test.ts" },
			children: {
				*allTests() {
					yield { result: () => ({ state: "passed" }) };
					yield { result: () => ({ state: "failed" }) };
				},
			},
		};
		reporter.onTestSuiteReady(suite);
		reporter.onTestSuiteResult(suite);
		expect(events.find((e) => e._tag === "SuiteStarted")).toMatchObject({ suiteName: "math", modulePath: "a.test.ts" });
		expect(events.find((e) => e._tag === "SuiteFinished")).toMatchObject({
			suiteName: "math",
			passCount: 1,
			failCount: 1,
		});
	});

	it("publishes HookStarted and HookFinished with a derived duration", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		const hook = { name: "beforeAll", entity: { name: "math", relativeModuleId: "a.test.ts", errors: () => [] } };
		reporter.onHookStart(hook);
		reporter.onHookEnd(hook);
		expect(events.find((e) => e._tag === "HookStarted")).toMatchObject({ hookType: "beforeAll", scopeName: "math" });
		const finished = events.find((e) => e._tag === "HookFinished");
		expect(finished).toMatchObject({ hookType: "beforeAll", status: "passed" });
		expect((finished as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
	});

	it("publishes ConsoleLog for a captured user console line", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		reporter.onUserConsoleLog({ content: "hello", type: "stdout", time: 123 });
		expect(events.find((e) => e._tag === "ConsoleLog")).toMatchObject({ level: "stdout", content: "hello", time: 123 });
	});

	it("publishes RunTimedOut when the process timeout fires", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		reporter.onProcessTimeout();
		expect(events.find((e) => e._tag === "RunTimedOut")).toBeDefined();
	});

	it("publishes TestAnnotated and TestArtifactRecorded for a test case", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		const testCase = { name: "adds", module: { relativeModuleId: "a.test.ts" } };
		reporter.onTestCaseAnnotate(testCase, { message: "slow path" });
		reporter.onTestCaseArtifactRecord(testCase, { type: "internal:annotation" });
		expect(events.find((e) => e._tag === "TestAnnotated")).toMatchObject({ testName: "adds", annotation: "slow path" });
		expect(events.find((e) => e._tag === "TestArtifactRecorded")).toMatchObject({ testName: "adds" });
	});

	it("publishes WatcherReady and WatcherRerun for watch-mode transitions", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		reporter.onWatcherStart();
		reporter.onWatcherRerun(["a.test.ts"], "changed");
		expect(events.find((e) => e._tag === "WatcherReady")).toBeDefined();
		expect(events.find((e) => e._tag === "WatcherRerun")).toMatchObject({
			triggerFiles: ["a.test.ts"],
			reason: "changed",
		});
	});

	it("flags a timeout-flavored failure as timedOut on TestFinished", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		const module = makeTestModule("a.test.ts", [
			{ name: "slow", state: "failed", error: { message: "Test timed out in 5000ms." } },
		]);
		for (const test of module.children.allTests()) {
			reporter.onTestCaseResult(test);
		}
		const finished = events.find((e) => e._tag === "TestFinished");
		expect(finished).toMatchObject({ status: "failed", timedOut: true });
	});

	it("counts a timed-out test in ModuleFinished.timeoutCount, not failCount", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		const module = makeTestModule("a.test.ts", [
			{ name: "ok", state: "passed" },
			{ name: "broke", state: "failed", error: { message: "expected 1 to be 2" } },
			{ name: "slow", state: "failed", error: { message: "Test timed out in 5000ms." } },
		]);
		reporter.onTestModuleEnd(module);
		expect(events.find((e) => e._tag === "ModuleFinished")).toMatchObject({
			passCount: 1,
			failCount: 1,
			timeoutCount: 1,
		});
	});

	it("logs to stderr when the tap throws but does not propagate", () => {
		const errors: string[] = [];
		const originalWrite = process.stderr.write.bind(process.stderr);
		process.stderr.write = ((chunk: string | Uint8Array) => {
			errors.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
			return true;
		}) as typeof process.stderr.write;
		try {
			const reporter = new AgentReporter({
				onRunEvent: () => {
					throw new Error("boom");
				},
			});
			expect(() => reporter.onTestRunStart([])).not.toThrow();
		} finally {
			process.stderr.write = originalWrite;
		}
		const combined = errors.join("");
		expect(combined).toContain("onRunEvent tap threw");
	});

	it("tallies per-tag test counts onto ModuleFinished", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		const module = makeTestModule("a.test.ts", [
			{ name: "u1", state: "passed", tags: ["unit"] },
			{ name: "u2", state: "passed", tags: ["unit"] },
			{ name: "i1", state: "passed", tags: ["int"] },
		]);
		reporter.onTestModuleEnd(module);
		expect(events.find((e) => e._tag === "ModuleFinished")).toMatchObject({
			tagCounts: { unit: 2, int: 1 },
		});
	});

	it("extracts expected/received from Vitest assertion error onto TestFinished", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		const module = makeTestModule("math.test.ts", [
			{
				name: "adds numbers",
				state: "failed",
				error: {
					message: "AssertionError: expected 3 to be 4",
					expected: 4,
					actual: 3,
				},
			},
		]);
		for (const test of module.children.allTests()) {
			reporter.onTestCaseResult(test);
		}
		const finished = events.find((e) => e._tag === "TestFinished");
		expect(finished).toMatchObject({
			status: "failed",
			error: {
				message: "AssertionError: expected 3 to be 4",
				expected: "4",
				received: "3",
			},
		});
	});

	it("omits expected/received on TestFinished when the error has no structured values", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		const module = makeTestModule("a.test.ts", [
			{
				name: "throws",
				state: "failed",
				error: { message: "Error: something went wrong" },
			},
		]);
		for (const test of module.children.allTests()) {
			reporter.onTestCaseResult(test);
		}
		const finished = events.find((e) => e._tag === "TestFinished");
		expect(finished).toMatchObject({ status: "failed" });
		const err = (finished as { error?: { expected?: unknown; received?: unknown } })?.error;
		expect(err?.expected).toBeUndefined();
		expect(err?.received).toBeUndefined();
	});

	it("stringifies an object expected/actual value onto TestFinished", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		const module = makeTestModule("obj.test.ts", [
			{
				name: "deep equal",
				state: "failed",
				error: {
					message: "AssertionError: expected objects to be equal",
					expected: { x: 1 },
					actual: { x: 2 },
				},
			},
		]);
		for (const test of module.children.allTests()) {
			reporter.onTestCaseResult(test);
		}
		const finished = events.find((e) => e._tag === "TestFinished");
		expect(finished).toMatchObject({
			error: {
				expected: '{"x":1}',
				received: '{"x":2}',
			},
		});
	});
});
