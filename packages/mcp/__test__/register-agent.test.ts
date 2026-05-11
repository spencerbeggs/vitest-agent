import { Layer, ManagedRuntime } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { OutputPipelineLive, ProjectDiscoveryTest } from "vitest-agent-sdk";
import type { McpContext } from "../src/context.js";
import { createCallerFactory, createCurrentSessionIdRef, createSessionContextRef } from "../src/context.js";
import { appRouter } from "../src/router.js";
import { DataStoreTestLayer } from "./utils/layers.js";

const TestLayer = Layer.mergeAll(DataStoreTestLayer, OutputPipelineLive, ProjectDiscoveryTest.layer([]));
const testRuntime = ManagedRuntime.make(TestLayer);

const makeCaller = () => {
	const factory = createCallerFactory(appRouter);
	return factory({
		runtime: testRuntime as unknown as McpContext["runtime"],
		cwd: process.cwd(),
		currentSessionId: createCurrentSessionIdRef(),
		sessionContext: createSessionContextRef(),
	});
};

afterAll(async () => {
	await testRuntime.dispose();
});

const seedSession = async (chatId: string) => {
	const caller = makeCaller();
	await caller.inventory({ kind: "session" }); // best-effort warm-up
	// Seed the session row directly through DataStore via the runtime.
	const { Effect } = await import("effect");
	const { DataStore } = await import("vitest-agent-sdk");
	await testRuntime.runPromise(
		Effect.gen(function* () {
			const store = yield* DataStore;
			yield* store.writeSession({
				chatId: chatId,
				project: "test-project",
				cwd: "/tmp/test",
				agentKind: "main",
				triageWasNonEmpty: false,
				startedAt: new Date().toISOString(),
			});
		}),
	);
};

describe("register_agent MCP tool", () => {
	it("rejects an agentType that does not start with the host-kind prefix", async () => {
		const caller = makeCaller();
		const result = await caller.register_agent({
			chatId: "any-session",
			agentType: "cursor-main",
			hostKind: "claude-code",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("INVALID_AGENT_TYPE_PREFIX");
			expect(result.error.expectedPrefix).toBe("claude-code-");
		}
	});

	it("returns SESSION_NOT_FOUND when the host has not registered the session yet", async () => {
		const caller = makeCaller();
		const result = await caller.register_agent({
			chatId: "never-seen-session",
			agentType: "claude-code-main",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("SESSION_NOT_FOUND");
		}
	});

	it("registers a fresh agent and returns ok:true with agentId", async () => {
		await seedSession("session-fresh-1");
		const caller = makeCaller();
		const result = await caller.register_agent({
			chatId: "session-fresh-1",
			agentType: "claude-code-main",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.agentId).toMatch(/^[0-9a-f-]{36}$/);
		}
	});

	it("returns AGENT_ALREADY_REGISTERED on a second call with the same idempotency triple", async () => {
		await seedSession("session-idem-1");
		const caller = makeCaller();
		const first = await caller.register_agent({
			chatId: "session-idem-1",
			agentType: "claude-code-main",
		});
		expect(first.ok).toBe(true);
		const second = await caller.register_agent({
			chatId: "session-idem-1",
			agentType: "claude-code-main",
		});
		expect(second.ok).toBe(false);
		if (!second.ok && first.ok) {
			expect(second.error.code).toBe("AGENT_ALREADY_REGISTERED");
			expect(second.error.existingAgentId).toBe(first.agentId);
		}
	});

	it("two distinct clientNonces produce two distinct agents under the same parent", async () => {
		await seedSession("session-sib-1");
		const caller = makeCaller();
		const main = await caller.register_agent({
			chatId: "session-sib-1",
			agentType: "claude-code-main",
		});
		expect(main.ok).toBe(true);
		if (!main.ok) return;

		const subA = await caller.register_agent({
			chatId: "session-sib-1",
			agentType: "claude-code-tdd-task",
			parentAgentId: main.agentId,
			clientNonce: "sib-A",
		});
		const subB = await caller.register_agent({
			chatId: "session-sib-1",
			agentType: "claude-code-tdd-task",
			parentAgentId: main.agentId,
			clientNonce: "sib-B",
		});
		expect(subA.ok).toBe(true);
		expect(subB.ok).toBe(true);
		if (subA.ok && subB.ok) {
			expect(subA.agentId).not.toBe(subB.agentId);
		}
	});
});
