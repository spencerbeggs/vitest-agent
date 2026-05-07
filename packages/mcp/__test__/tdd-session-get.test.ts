import { Effect, Layer, ManagedRuntime } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { DataStore, OutputPipelineLive, ProjectDiscoveryTest } from "vitest-agent-sdk";
import type { McpContext } from "../src/context.js";
import { createCallerFactory, createCurrentSessionIdRef } from "../src/context.js";
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
	});
}

afterAll(async () => {
	await testRuntime.dispose();
});

describe("tdd_session_get", () => {
	it("returns 'No TDD session' when id does not exist", async () => {
		const caller = createTestCaller();
		const result = await caller.tdd_session_get({ id: 99999 });
		expect(result).toContain("No TDD session with id=99999");
	});

	it("should include '## Goals and Behaviors' in output when goals exist", async () => {
		// Given: a TDD session with a goal and a behavior
		const sessionId = await testRuntime.runPromise(
			Effect.gen(function* () {
				const store = yield* DataStore;
				return yield* store.writeSession({
					cc_session_id: "cc-tdd-get-goals-test",
					project: "default",
					cwd: process.cwd(),
					agent_kind: "main",
					started_at: new Date().toISOString(),
				});
			}),
		);

		const caller = createTestCaller();
		const tdd = await caller.tdd_session_start({ sessionId, goal: "implement parser" });
		const tddId = (tdd as { id: number }).id;

		await caller.tdd_goal_create({ sessionId: tddId, goal: "Handle empty input" });

		// When: we call tdd_session_get
		const result = await caller.tdd_session_get({ id: tddId });

		// Then: the output should include a Goals and Behaviors section
		expect(result).toContain("## Goals and Behaviors");
	});

	it("should render each goal with ordinal prefix in output", async () => {
		// Given: a TDD session with two goals
		const sessionId = await testRuntime.runPromise(
			Effect.gen(function* () {
				const store = yield* DataStore;
				return yield* store.writeSession({
					cc_session_id: "cc-tdd-get-goal-ordinal-test",
					project: "default",
					cwd: process.cwd(),
					agent_kind: "main",
					started_at: new Date().toISOString(),
				});
			}),
		);

		const caller = createTestCaller();
		const tdd = await caller.tdd_session_start({ sessionId, goal: "implement features" });
		const tddId = (tdd as { id: number }).id;

		await caller.tdd_goal_create({ sessionId: tddId, goal: "Goal Alpha" });
		await caller.tdd_goal_create({ sessionId: tddId, goal: "Goal Beta" });

		// When: we call tdd_session_get
		const result = await caller.tdd_session_get({ id: tddId });

		// Then: each goal is listed with a 1-based ordinal and its text
		expect(result).toContain("### Goal 1:");
		expect(result).toContain("Goal Alpha");
		expect(result).toContain("### Goal 2:");
		expect(result).toContain("Goal Beta");
	});

	it("should render behaviors nested under their goal with status label", async () => {
		// Given: a TDD session with a goal that has two behaviors
		const sessionId = await testRuntime.runPromise(
			Effect.gen(function* () {
				const store = yield* DataStore;
				return yield* store.writeSession({
					cc_session_id: "cc-tdd-get-behavior-status-test",
					project: "default",
					cwd: process.cwd(),
					agent_kind: "main",
					started_at: new Date().toISOString(),
				});
			}),
		);

		const caller = createTestCaller();
		const tdd = await caller.tdd_session_start({ sessionId, goal: "handle validation" });
		const tddId = (tdd as { id: number }).id;

		const goalResult = (await caller.tdd_goal_create({ sessionId: tddId, goal: "Validate inputs" })) as {
			ok: true;
			goal: { id: number };
		};

		await caller.tdd_behavior_create({ goalId: goalResult.goal.id, behavior: "rejects empty string" });
		await caller.tdd_behavior_create({ goalId: goalResult.goal.id, behavior: "accepts valid token" });

		// When: we call tdd_session_get
		const result = await caller.tdd_session_get({ id: tddId });

		// Then: behaviors appear under the goal with their status
		expect(result).toContain("rejects empty string");
		expect(result).toContain("accepts valid token");
		expect(result).toContain("pending");
	});

	it("does not include Goals and Behaviors section when session has no goals", async () => {
		// Given: a TDD session with no goals
		const sessionId = await testRuntime.runPromise(
			Effect.gen(function* () {
				const store = yield* DataStore;
				return yield* store.writeSession({
					cc_session_id: "cc-tdd-get-no-goals-test",
					project: "default",
					cwd: process.cwd(),
					agent_kind: "main",
					started_at: new Date().toISOString(),
				});
			}),
		);

		const caller = createTestCaller();
		const tdd = await caller.tdd_session_start({ sessionId, goal: "no goals yet" });
		const tddId = (tdd as { id: number }).id;

		// When: we call tdd_session_get (no goals created)
		const result = await caller.tdd_session_get({ id: tddId });

		// Then: no Goals and Behaviors section appears
		expect(result).not.toContain("## Goals and Behaviors");
	});
});
