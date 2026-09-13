import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { EnvironmentDetectorLive, classifyEnvironment } from "../src/layers/EnvironmentDetectorLive.js";
import { EnvironmentDetector } from "../src/services/EnvironmentDetector.js";

type Env = Record<string, string | undefined>;

const run = <A, E>(effect: Effect.Effect<A, E, EnvironmentDetector>, env: Env = {}) =>
	Effect.runPromise(Effect.provide(effect, EnvironmentDetectorLive(env)));

const detect = (env: Env) =>
	run(
		Effect.flatMap(EnvironmentDetector, (d) => d.detect()),
		env,
	);

describe("EnvironmentDetectorLive", () => {
	it("returns environment as one of the four types", async () => {
		const env = await detect({});
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

	// CI detection reads only the injected env map; `std-env`'s `isAgent` is
	// process-global and wins first, so the CI branches are exercised through
	// the pure classifier with the agent probe forced off.
	describe("CI detection from the injected env (classifyEnvironment, agent off)", () => {
		it("detects ci-github when GITHUB_ACTIONS=true", () => {
			expect(classifyEnvironment({ GITHUB_ACTIONS: "true", CI: "true" }, false)).toBe("ci-github");
		});

		it("detects ci-github when GITHUB_ACTIONS=1", () => {
			expect(classifyEnvironment({ GITHUB_ACTIONS: "1", CI: "true" }, false)).toBe("ci-github");
		});

		it("detects ci-generic when CI=true but GITHUB_ACTIONS is absent", () => {
			expect(classifyEnvironment({ GITHUB_ACTIONS: "", CI: "true" }, false)).toBe("ci-generic");
		});

		it("detects terminal when neither CI nor GITHUB_ACTIONS is set", () => {
			expect(classifyEnvironment({ GITHUB_ACTIONS: "", CI: "" }, false)).toBe("terminal");
		});

		it("agent shell wins over CI", () => {
			expect(classifyEnvironment({ GITHUB_ACTIONS: "true", CI: "true" }, true)).toBe("agent-shell");
		});
	});

	it("does not read process.env — a CI process env is invisible when the injected map is empty", async () => {
		// Whatever the host process env says, an empty map can only yield
		// "terminal" or "agent-shell" (the std-env agent probe is process-global).
		const env = await detect({});
		expect(["terminal", "agent-shell"]).toContain(env);
	});
});
