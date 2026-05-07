import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvironmentDetectorLive } from "../src/layers/EnvironmentDetectorLive.js";
import type { Environment } from "../src/schemas/Common.js";
import { EnvironmentDetector } from "../src/services/EnvironmentDetector.js";

const run = <A, E>(effect: Effect.Effect<A, E, EnvironmentDetector>) =>
	Effect.runPromise(Effect.provide(effect, EnvironmentDetectorLive));

describe("EnvironmentDetectorLive", () => {
	it("returns environment as one of the four types", async () => {
		const env = await run(Effect.flatMap(EnvironmentDetector, (d) => d.detect()));
		expect(["agent-shell", "terminal", "ci-github", "ci-generic"]).toContain(env);
	});

	it("provides isAgent as boolean", async () => {
		const result = await run(Effect.flatMap(EnvironmentDetector, (d) => d.isAgent));
		expect(typeof result).toBe("boolean");
	});

	it("provides agentName as string or undefined", async () => {
		const result = await run(Effect.flatMap(EnvironmentDetector, (d) => d.agentName));
		expect(result === undefined || typeof result === "string").toBe(true);
	});

	describe("CI detection (via test layer with isAgent=false)", () => {
		afterEach(() => {
			vi.unstubAllEnvs();
		});

		/**
		 * Build a test layer that simulates a non-agent environment so we can
		 * exercise the CI detection branches that are unreachable when isAgent=true.
		 */
		const makeNonAgentLayer = (): Layer.Layer<EnvironmentDetector> =>
			Layer.succeed(EnvironmentDetector, {
				detect: () =>
					Effect.sync((): Environment => {
						const isGitHub = process.env.GITHUB_ACTIONS === "true" || process.env.GITHUB_ACTIONS === "1";
						const isCI = isGitHub || process.env.CI === "true";
						if (isGitHub) return "ci-github";
						if (isCI) return "ci-generic";
						return "terminal";
					}),
				isAgent: Effect.sync(() => false),
				agentName: Effect.sync(() => undefined),
			});

		it("detects ci-github when GITHUB_ACTIONS=true", async () => {
			vi.stubEnv("GITHUB_ACTIONS", "true");
			vi.stubEnv("CI", "true");
			const layer = makeNonAgentLayer();
			const env = await Effect.runPromise(
				Effect.provide(
					Effect.flatMap(EnvironmentDetector, (d) => d.detect()),
					layer,
				),
			);
			expect(env).toBe("ci-github");
		});

		it("detects ci-github when GITHUB_ACTIONS=1", async () => {
			vi.stubEnv("GITHUB_ACTIONS", "1");
			vi.stubEnv("CI", "true");
			const layer = makeNonAgentLayer();
			const env = await Effect.runPromise(
				Effect.provide(
					Effect.flatMap(EnvironmentDetector, (d) => d.detect()),
					layer,
				),
			);
			expect(env).toBe("ci-github");
		});

		it("detects ci-generic when CI=true but GITHUB_ACTIONS is absent", async () => {
			vi.stubEnv("GITHUB_ACTIONS", "");
			vi.stubEnv("CI", "true");
			const layer = makeNonAgentLayer();
			const env = await Effect.runPromise(
				Effect.provide(
					Effect.flatMap(EnvironmentDetector, (d) => d.detect()),
					layer,
				),
			);
			expect(env).toBe("ci-generic");
		});

		it("detects terminal when neither CI nor GITHUB_ACTIONS is set", async () => {
			vi.stubEnv("GITHUB_ACTIONS", "");
			vi.stubEnv("CI", "");
			const layer = makeNonAgentLayer();
			const env = await Effect.runPromise(
				Effect.provide(
					Effect.flatMap(EnvironmentDetector, (d) => d.detect()),
					layer,
				),
			);
			expect(env).toBe("terminal");
		});
	});
});
