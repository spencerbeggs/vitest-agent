import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { DetailResolverLive } from "../src/layers/DetailResolverLive.js";
import { DetailResolver } from "../src/services/DetailResolver.js";

const run = <A, E>(effect: Effect.Effect<A, E, DetailResolver>) =>
	Effect.runPromise(Effect.provide(effect, DetailResolverLive));

describe("DetailResolverLive", () => {
	it("agent defaults to verbose", async () => {
		const result = await run(
			Effect.flatMap(DetailResolver, (r) => r.resolve("agent", { hasFailures: false, belowTargets: false })),
		);
		expect(result).toBe("verbose");
	});

	it("human with failures -> verbose", async () => {
		const result = await run(
			Effect.flatMap(DetailResolver, (r) => r.resolve("human", { hasFailures: true, belowTargets: false })),
		);
		expect(result).toBe("verbose");
	});

	it("human with below targets -> standard", async () => {
		const result = await run(
			Effect.flatMap(DetailResolver, (r) => r.resolve("human", { hasFailures: false, belowTargets: true })),
		);
		expect(result).toBe("standard");
	});

	it("human all pass no targets -> neutral", async () => {
		const result = await run(
			Effect.flatMap(DetailResolver, (r) =>
				r.resolve("human", {
					hasFailures: false,
					belowTargets: false,
					hasTargets: false,
				}),
			),
		);
		expect(result).toBe("neutral");
	});

	it("human all pass targets met -> minimal", async () => {
		const result = await run(
			Effect.flatMap(DetailResolver, (r) =>
				r.resolve("human", {
					hasFailures: false,
					belowTargets: false,
					hasTargets: true,
				}),
			),
		);
		expect(result).toBe("minimal");
	});

	it("ci defaults to verbose", async () => {
		const result = await run(
			Effect.flatMap(DetailResolver, (r) => r.resolve("ci", { hasFailures: false, belowTargets: false })),
		);
		expect(result).toBe("verbose");
	});

	it("explicit override takes precedence", async () => {
		const result = await run(
			Effect.flatMap(DetailResolver, (r) => r.resolve("human", { hasFailures: true, belowTargets: false }, "minimal")),
		);
		expect(result).toBe("minimal");
	});
});
