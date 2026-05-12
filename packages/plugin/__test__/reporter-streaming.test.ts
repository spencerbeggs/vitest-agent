/**
 * Tests for the streaming Vitest reporter callbacks on AgentReporter.
 * These verify the onRunEvent tap fires with correctly-shaped RunEvents
 * as the run progresses, without involving persistence or rendering.
 *
 * @packageDocumentation
 */

import { describe, expect, it } from "vitest";
import type { RunEvent } from "vitest-agent-sdk";
import { AgentReporter } from "../src/reporter.js";

interface FakeTestSpec {
	readonly name: string;
	readonly state: "passed" | "failed" | "skipped";
	readonly duration?: number;
	readonly suite?: string;
	readonly error?: { message: string; diff?: string };
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

	it("publishes TestStarted and TestFinished from a single test-case-result hook", () => {
		const events: RunEvent[] = [];
		const reporter = new AgentReporter({ onRunEvent: (e) => events.push(e) });
		reporter.onTestRunStart([]);
		const module = makeTestModule("a.test.ts", [{ name: "passes", state: "passed", duration: 4 }]);
		for (const test of module.children.allTests()) {
			reporter.onTestCaseResult(test);
		}
		const tags = events.map((e) => e._tag);
		expect(tags).toContain("TestStarted");
		expect(tags).toContain("TestFinished");
		const finished = events.find((e) => e._tag === "TestFinished");
		expect(finished).toMatchObject({ status: "passed", durationMs: 4 });
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
			reporter.onTestCaseResult(test);
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
});
