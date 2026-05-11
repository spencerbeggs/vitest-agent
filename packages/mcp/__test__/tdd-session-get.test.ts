import { Effect, Layer, ManagedRuntime } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { DataStore, OutputPipelineLive, ProjectDiscoveryTest } from "vitest-agent-sdk";
import type { McpContext } from "../src/context.js";
import { createCallerFactory, createCurrentSessionIdRef, createSessionContextRef } from "../src/context.js";
import { appRouter } from "../src/router.js";
import { DataStoreTestLayer } from "./utils/layers.js";

const TestLayer = Layer.mergeAll(DataStoreTestLayer, OutputPipelineLive, ProjectDiscoveryTest.layer([]));
const testRuntime = ManagedRuntime.make(TestLayer);

function createTestCaller() {
	const factory = createCallerFactory(appRouter);
	return factory({
		runtime: testRuntime as unknown as McpContext["runtime"],
		cwd: process.cwd(),
		currentSessionId: createCurrentSessionIdRef(null),
		sessionContext: createSessionContextRef(),
	});
}

afterAll(async () => {
	await testRuntime.dispose();
});

describe("tdd_session_get (now tdd_task action=get)", () => {
	it("returns found=false when id does not exist", async () => {
		const caller = createTestCaller();
		const result = await caller.tdd_task({ action: "get", tddTaskId: 99999 });
		expect(result.action).toBe("get");
		if (result.action === "get") {
			expect(result.found).toBe(false);
			if (result.found === false) expect(result.tddTaskId).toBe(99999);
		}
	});

	it("attaches goals[] to the structured task when goals exist", async () => {
		const sessionId = await testRuntime.runPromise(
			Effect.gen(function* () {
				const store = yield* DataStore;
				return yield* store.writeSession({
					chatId: "cc-tdd-get-goals-test",
					project: "default",
					cwd: process.cwd(),
					agentKind: "main",
					startedAt: new Date().toISOString(),
				});
			}),
		);

		const caller = createTestCaller();
		const tdd = await caller.tdd_task({ action: "start", sessionId, goal: "implement parser" });
		const tddId = (tdd as { tddTaskId: number }).tddTaskId;
		await caller.tdd_goal({ action: "create", tddTaskId: tddId, goal: "Handle empty input" });

		const result = await caller.tdd_task({ action: "get", tddTaskId: tddId });
		expect(result.action).toBe("get");
		if (result.action === "get" && result.found) {
			expect(result.task.goals.length).toBeGreaterThan(0);
			expect(result.task.goals[0].goal).toBe("Handle empty input");
		}
	});

	it("preserves the goal ordinal in the structured payload", async () => {
		const sessionId = await testRuntime.runPromise(
			Effect.gen(function* () {
				const store = yield* DataStore;
				return yield* store.writeSession({
					chatId: "cc-tdd-get-goal-ordinal-test",
					project: "default",
					cwd: process.cwd(),
					agentKind: "main",
					startedAt: new Date().toISOString(),
				});
			}),
		);

		const caller = createTestCaller();
		const tdd = await caller.tdd_task({ action: "start", sessionId, goal: "implement features" });
		const tddId = (tdd as { tddTaskId: number }).tddTaskId;
		await caller.tdd_goal({ action: "create", tddTaskId: tddId, goal: "Goal Alpha" });
		await caller.tdd_goal({ action: "create", tddTaskId: tddId, goal: "Goal Beta" });

		const result = await caller.tdd_task({ action: "get", tddTaskId: tddId });
		if (result.action === "get" && result.found) {
			const goals = result.task.goals;
			expect(goals.length).toBe(2);
			expect(goals[0].ordinal).toBe(0);
			expect(goals[0].goal).toBe("Goal Alpha");
			expect(goals[1].ordinal).toBe(1);
			expect(goals[1].goal).toBe("Goal Beta");
		}
	});

	it("nests behaviors[] under their goal with a status field", async () => {
		const sessionId = await testRuntime.runPromise(
			Effect.gen(function* () {
				const store = yield* DataStore;
				return yield* store.writeSession({
					chatId: "cc-tdd-get-behavior-status-test",
					project: "default",
					cwd: process.cwd(),
					agentKind: "main",
					startedAt: new Date().toISOString(),
				});
			}),
		);

		const caller = createTestCaller();
		const tdd = await caller.tdd_task({ action: "start", sessionId, goal: "handle validation" });
		const tddId = (tdd as { tddTaskId: number }).tddTaskId;
		const goalResult = (await caller.tdd_goal({ action: "create", tddTaskId: tddId, goal: "Validate inputs" })) as {
			ok: true;
			goal: { id: number };
		};
		await caller.tdd_behavior({ action: "create", goalId: goalResult.goal.id, behavior: "rejects empty string" });
		await caller.tdd_behavior({ action: "create", goalId: goalResult.goal.id, behavior: "accepts valid token" });

		const result = await caller.tdd_task({ action: "get", tddTaskId: tddId });
		if (result.action === "get" && result.found) {
			const goal = result.task.goals.find((g) => g.id === goalResult.goal.id);
			expect(goal).toBeDefined();
			expect(goal?.behaviors.length).toBe(2);
			expect(goal?.behaviors.some((b) => b.behavior === "rejects empty string")).toBe(true);
			expect(goal?.behaviors.some((b) => b.behavior === "accepts valid token")).toBe(true);
			expect(goal?.behaviors[0].status).toBe("pending");
		}
	});

	it("returns an empty goals[] when no goals were created", async () => {
		const sessionId = await testRuntime.runPromise(
			Effect.gen(function* () {
				const store = yield* DataStore;
				return yield* store.writeSession({
					chatId: "cc-tdd-get-no-goals-test",
					project: "default",
					cwd: process.cwd(),
					agentKind: "main",
					startedAt: new Date().toISOString(),
				});
			}),
		);

		const caller = createTestCaller();
		const tdd = await caller.tdd_task({ action: "start", sessionId, goal: "no goals yet" });
		const tddId = (tdd as { tddTaskId: number }).tddTaskId;

		const result = await caller.tdd_task({ action: "get", tddTaskId: tddId });
		if (result.action === "get" && result.found) {
			expect(result.task.goals).toEqual([]);
		}
	});
});
