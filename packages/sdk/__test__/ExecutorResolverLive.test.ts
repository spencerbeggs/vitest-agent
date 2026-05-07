import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { ExecutorResolverLive } from "../src/layers/ExecutorResolverLive.js";
import { ExecutorResolver } from "../src/services/ExecutorResolver.js";

const run = <A, E>(effect: Effect.Effect<A, E, ExecutorResolver>) =>
	Effect.runPromise(Effect.provide(effect, ExecutorResolverLive));

describe("ExecutorResolverLive", () => {
	it("resolves agent-shell -> agent", async () => {
		const result = await run(Effect.flatMap(ExecutorResolver, (r) => r.resolve("agent-shell", "auto")));
		expect(result).toBe("agent");
	});

	it("resolves terminal -> human", async () => {
		const result = await run(Effect.flatMap(ExecutorResolver, (r) => r.resolve("terminal", "auto")));
		expect(result).toBe("human");
	});

	it("resolves ci-github -> ci", async () => {
		const result = await run(Effect.flatMap(ExecutorResolver, (r) => r.resolve("ci-github", "auto")));
		expect(result).toBe("ci");
	});

	it("resolves ci-generic -> ci", async () => {
		const result = await run(Effect.flatMap(ExecutorResolver, (r) => r.resolve("ci-generic", "auto")));
		expect(result).toBe("ci");
	});

	it("mode 'agent' overrides to agent", async () => {
		const result = await run(Effect.flatMap(ExecutorResolver, (r) => r.resolve("terminal", "agent")));
		expect(result).toBe("agent");
	});

	it("mode 'silent' overrides to human", async () => {
		const result = await run(Effect.flatMap(ExecutorResolver, (r) => r.resolve("agent-shell", "silent")));
		expect(result).toBe("human");
	});
});
