import { Effect, Layer } from "effect";
import { agent, isAgent } from "std-env";
import type { Environment } from "../schemas/Common.js";
import { EnvironmentDetector } from "../services/EnvironmentDetector.js";

const isGitHub = (): boolean => process.env.GITHUB_ACTIONS === "true" || process.env.GITHUB_ACTIONS === "1";

const isCI = (): boolean => isGitHub() || process.env.CI === "true";
/** @public */
export const EnvironmentDetectorLive: Layer.Layer<EnvironmentDetector> = Layer.succeed(EnvironmentDetector, {
	detect: () =>
		Effect.sync((): Environment => {
			if (isAgent) return "agent-shell";
			if (isGitHub()) return "ci-github";
			if (isCI()) return "ci-generic";
			return "terminal";
		}),
	isAgent: Effect.sync(() => isAgent),
	agentName: Effect.sync(() => agent ?? undefined),
});
