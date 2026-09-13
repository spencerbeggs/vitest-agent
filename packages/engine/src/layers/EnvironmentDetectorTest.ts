import type { Environment } from "@vitest-agent/sdk";
import { Effect, Layer } from "effect";
import { EnvironmentDetector } from "../services/EnvironmentDetector.js";
/** @public */
export const EnvironmentDetectorTest = {
	layer: (env: Environment = "terminal") =>
		Layer.succeed(EnvironmentDetector, {
			detect: () => Effect.succeed(env),
			isAgent: Effect.succeed(env === "agent-shell"),
			agentName: Effect.succeed(env === "agent-shell" ? "test-agent" : undefined),
		}),
};
