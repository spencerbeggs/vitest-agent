import { Layer, ManagedRuntime } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { OutputPipelineLive, ProjectDiscoveryTest } from "vitest-agent-sdk";
import type { McpContext } from "../src/context.js";
import { createCallerFactory, createCurrentSessionIdRef } from "../src/context.js";
import { appRouter } from "../src/router.js";
import { DataStoreTestLayer } from "./utils/layers.js";

const TestLayer = Layer.mergeAll(DataStoreTestLayer, OutputPipelineLive, ProjectDiscoveryTest.layer([]));
const testRuntime = ManagedRuntime.make(TestLayer);

const makeCaller = (initial: string | null = null) => {
	const factory = createCallerFactory(appRouter);
	return factory({
		runtime: testRuntime as unknown as McpContext["runtime"],
		cwd: process.cwd(),
		currentSessionId: createCurrentSessionIdRef(initial),
	});
};

afterAll(async () => {
	await testRuntime.dispose();
});

describe("get_current_session_id / set_current_session_id", () => {
	it("returns null when no initial id was seeded", async () => {
		const caller = makeCaller();
		const result = await caller.get_current_session_id({});
		expect(result).toEqual({ currentSessionId: null });
	});

	it("returns the seeded id when bin started with an initial value", async () => {
		const caller = makeCaller("seeded-cc-id-123");
		const result = await caller.get_current_session_id({});
		expect(result).toEqual({ currentSessionId: "seeded-cc-id-123" });
	});

	it("set then get round-trips a string id", async () => {
		const caller = makeCaller();
		const setResult = await caller.set_current_session_id({ id: "agent-supplied-id" });
		expect(setResult).toEqual({ currentSessionId: "agent-supplied-id" });
		const getResult = await caller.get_current_session_id({});
		expect(getResult).toEqual({ currentSessionId: "agent-supplied-id" });
	});

	it("set with null clears a previously-set id", async () => {
		const caller = makeCaller("initial");
		await caller.set_current_session_id({ id: null });
		const after = await caller.get_current_session_id({});
		expect(after).toEqual({ currentSessionId: null });
	});

	it("each caller's ref is independent", async () => {
		// One Claude Code window's MCP server has its own ref; another
		// window's server has its own. Setting one must not leak into the
		// other.
		const callerA = makeCaller("window-a");
		const callerB = makeCaller("window-b");
		await callerA.set_current_session_id({ id: "a-updated" });
		expect((await callerA.get_current_session_id({})).currentSessionId).toBe("a-updated");
		expect((await callerB.get_current_session_id({})).currentSessionId).toBe("window-b");
	});
});
