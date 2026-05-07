import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DataReader } from "vitest-agent-sdk";
import { empty, flaky, singlePassingRun, withFailures, withTddSession } from "vitest-agent-sdk/testing";

describe("vitest-agent-sdk/testing preset factories", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "va-preset-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("empty: DB has no test runs", async () => {
		const rt = ManagedRuntime.make(empty(join(tmpDir, "data.db")));
		try {
			const runs = await rt.runPromise(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.getRunsByProject();
				}),
			);
			expect(runs).toHaveLength(0);
		} finally {
			await rt.dispose();
		}
	});

	it("singlePassingRun: one run with 3 passing tests", async () => {
		const rt = ManagedRuntime.make(singlePassingRun(join(tmpDir, "data.db")));
		try {
			const runs = await rt.runPromise(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.getRunsByProject();
				}),
			);
			expect(runs).toHaveLength(1);
			const [run] = runs;
			expect(run.lastResult).toBe("passed");
			expect(run.total).toBe(3);
			expect(run.passed).toBe(3);
			expect(run.failed).toBe(0);
		} finally {
			await rt.dispose();
		}
	});

	it("withFailures: one run with 2 failing and 2 passing tests", async () => {
		const rt = ManagedRuntime.make(withFailures(join(tmpDir, "data.db")));
		try {
			const runs = await rt.runPromise(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.getRunsByProject();
				}),
			);
			expect(runs).toHaveLength(1);
			const [run] = runs;
			expect(run.lastResult).toBe("failed");
			expect(run.failed).toBe(2);
			expect(run.passed).toBe(2);
		} finally {
			await rt.dispose();
		}
	});

	it("flaky: two runs with mixed outcomes and a flaky test detected", async () => {
		const rt = ManagedRuntime.make(flaky(join(tmpDir, "data.db")));
		try {
			const { runs, flakyTests } = await rt.runPromise(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					const runs = yield* reader.getRunsByProject();
					const flakyTests = yield* reader.getFlaky("default", null);
					return { runs, flakyTests };
				}),
			);

			expect(runs).toHaveLength(1);
			const [run] = runs;
			// The summary row reflects the most recent run (passed), with cumulative counts
			expect(run.project).toBe("default");

			// The flaky test should be detected: "async > resolves within timeout"
			// failed in run 1 and passed in run 2
			expect(flakyTests.length).toBeGreaterThanOrEqual(1);
			const flakyTest = flakyTests.find((t) => t.fullName === "async > resolves within timeout");
			expect(flakyTest).toBeDefined();
			expect(flakyTest?.failCount).toBeGreaterThanOrEqual(1);
			expect(flakyTest?.passCount).toBeGreaterThanOrEqual(1);
		} finally {
			await rt.dispose();
		}
	});

	it("withTddSession: TDD session has 1 goal and 2 behaviors", async () => {
		const rt = ManagedRuntime.make(withTddSession(join(tmpDir, "data.db")));
		try {
			const { sessions, goals, behaviors } = await rt.runPromise(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					// Find the agent session by cc_session_id
					const sessionDetail = yield* reader.getSessionByCcId("cc-preset-tdd");
					if (sessionDetail._tag === "None") {
						return { sessions: [], goals: [], behaviors: [] };
					}
					const agentSession = sessionDetail.value;
					// List TDD sessions associated with the agent session
					const sessions = yield* reader.listTddSessionsForSession(agentSession.id);
					if (sessions.length === 0) {
						return { sessions, goals: [], behaviors: [] };
					}
					// Get goals for the TDD session
					const goals = yield* reader.getGoalsBySession(sessions[0].id);
					// Get behaviors for the first goal
					const behaviors = goals.length > 0 ? yield* reader.getBehaviorsByGoal(goals[0].id) : [];
					return { sessions, goals, behaviors };
				}),
			);

			expect(sessions).toHaveLength(1);
			expect(goals).toHaveLength(1);
			expect(goals[0].goal).toBe("Handle edge cases");
			expect(behaviors).toHaveLength(2);
			const behaviorTexts = behaviors.map((b) => b.behavior);
			expect(behaviorTexts).toContain("rejects empty input");
			expect(behaviorTexts).toContain("rejects null input");
		} finally {
			await rt.dispose();
		}
	});
});
