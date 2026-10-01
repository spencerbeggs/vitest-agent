import { RuntimeEnv } from "@effected/env";
import type { Environment } from "@vitest-agent/sdk";
import { Context, Effect, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import { EnvironmentDetectorLive, classifyEnvironment } from "../src/layers/EnvironmentDetectorLive.js";
import { EnvironmentDetector } from "../src/services/EnvironmentDetector.js";

type Env = Record<string, string | undefined>;

const probe = (env: Env) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const detector = yield* EnvironmentDetector;
			return {
				environment: yield* detector.detect(),
				isAgent: yield* detector.isAgent,
				agentName: yield* detector.agentName,
			};
		}).pipe(Effect.provide(EnvironmentDetectorLive(env))),
	);

const runtime = (fields: { agent?: string; ci?: string }) =>
	RuntimeEnv.make({
		agent: Option.fromNullishOr(fields.agent),
		ci: Option.fromNullishOr(fields.ci),
		terminal: Option.none(),
	});

describe("EnvironmentDetectorLive (reads only the injected env)", () => {
	it("an empty map is a terminal with no agent, whatever the host process env says", async () => {
		// This suite itself may run under an agent or in CI; an empty injected
		// map must still read as a bare terminal.
		expect(await probe({})).toEqual({ environment: "terminal", isAgent: false, agentName: undefined });
	});

	it("detects an agent shell from CLAUDECODE in the injected map", async () => {
		expect(await probe({ CLAUDECODE: "1" })).toEqual({
			environment: "agent-shell",
			isAgent: true,
			agentName: "claude",
		});
	});

	it("names the agent family from AI_AGENT", async () => {
		const result = await probe({ AI_AGENT: "cursor-agent_1-2" });
		expect(result.environment).toBe("agent-shell");
		expect(result.agentName).toBe("cursor");
	});

	it("an agent inside GitHub Actions is still an agent shell", async () => {
		expect((await probe({ CLAUDECODE: "1", GITHUB_ACTIONS: "true", CI: "true" })).environment).toBe("agent-shell");
	});

	it.each([
		[{ GITHUB_ACTIONS: "true", CI: "true" }, "ci-github"],
		[{ GITHUB_ACTIONS: "1" }, "ci-github"],
		[{ GITHUB_ACTIONS: "", CI: "true" }, "ci-generic"],
		[{ CI: "1" }, "ci-generic"],
		[{ CONTINUOUS_INTEGRATION: "true" }, "ci-generic"],
		[{ GITHUB_ACTIONS: "false", CI: "false" }, "terminal"],
		[{ GITHUB_ACTIONS: "", CI: "" }, "terminal"],
	] as const)("classifies %j as %s", async (env, expected) => {
		expect((await probe(env)).environment).toBe(expected);
	});

	it("two detectors over different maps in one layer graph do not share a snapshot", async () => {
		// `CurrentRuntimeEnv.layer` is one static (memoized) layer; the detector
		// wraps it in `Layer.fresh`, so each map is read on its own.
		class Other extends Context.Service<Other, Environment>()("test/OtherEnvironment") {}
		const other = Layer.effect(
			Other,
			Effect.flatMap(EnvironmentDetector, (d) => d.detect()),
		).pipe(Layer.provide(EnvironmentDetectorLive({ CI: "true" })));
		const [agent, ci] = await Effect.runPromise(
			Effect.all([Effect.flatMap(EnvironmentDetector, (d) => d.detect()), Other]).pipe(
				Effect.provide(Layer.merge(EnvironmentDetectorLive({ CLAUDECODE: "1" }), other)),
			),
		);
		expect([agent, ci]).toEqual(["agent-shell", "ci-generic"]);
	});
});

describe("classifyEnvironment (precedence over a RuntimeEnv snapshot)", () => {
	it.each([
		[{ agent: "claude", ci: "github-actions" }, "agent-shell"],
		[{ ci: "github-actions" }, "ci-github"],
		[{ ci: "generic" }, "ci-generic"],
		[{}, "terminal"],
	] as const)("%j -> %s", (fields, expected) => {
		expect(classifyEnvironment(runtime(fields))).toBe(expected);
	});
});
