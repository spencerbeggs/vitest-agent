import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { ExecutorResolverLive } from "../src/layers/ExecutorResolverLive.js";
import { ExecutorResolver } from "../src/services/ExecutorResolver.js";

const run = <A, E>(effect: Effect.Effect<A, E, ExecutorResolver>) =>
	Effect.runPromise(Effect.provide(effect, ExecutorResolverLive));

describe("ExecutorResolverLive", () => {
	it("resolves agent-shell -> agent", async () => {
		const result = await run(Effect.flatMap(ExecutorResolver, (r) => r.resolve("agent-shell")));
		expect(result).toBe("agent");
	});

	it("resolves terminal -> human", async () => {
		const result = await run(Effect.flatMap(ExecutorResolver, (r) => r.resolve("terminal")));
		expect(result).toBe("human");
	});

	it("resolves ci-github -> ci", async () => {
		const result = await run(Effect.flatMap(ExecutorResolver, (r) => r.resolve("ci-github")));
		expect(result).toBe("ci");
	});

	it("resolves ci-generic -> ci", async () => {
		const result = await run(Effect.flatMap(ExecutorResolver, (r) => r.resolve("ci-generic")));
		expect(result).toBe("ci");
	});
});
