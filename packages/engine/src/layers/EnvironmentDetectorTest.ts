import type { CiName } from "@effected/env";
import type { Environment } from "@vitest-agent/sdk";
import { Effect, Layer, Option } from "effect";
import { EnvironmentDetector } from "../services/EnvironmentDetector.js";

/** The CI vendor each environment implies when a test does not say otherwise. */
const CI_FOR_ENVIRONMENT: Record<Environment, Option.Option<CiName>> = {
	"ci-github": Option.some("github-actions"),
	"ci-generic": Option.some("generic"),
	"agent-shell": Option.none(),
	terminal: Option.none(),
};

/**
 * A fixed `EnvironmentDetector` for tests.
 *
 * @remarks
 * `ci` defaults to the vendor the environment implies (`ci-github` is
 * GitHub Actions, `ci-generic` another CI, the rest none). Pass
 * `options.ci` to decouple the two, as the live detector does for an agent
 * running inside GitHub Actions: `layer("agent-shell", { ci: "github-actions" })`.
 *
 * @public
 */
export const EnvironmentDetectorTest = {
	layer: (env: Environment = "terminal", options: { readonly ci?: CiName } = {}) =>
		Layer.succeed(EnvironmentDetector, {
			detect: () => Effect.succeed(env),
			isAgent: Effect.succeed(env === "agent-shell"),
			agentName: Effect.succeed(env === "agent-shell" ? "test-agent" : undefined),
			ci: Effect.succeed(options.ci !== undefined ? Option.some(options.ci) : CI_FOR_ENVIRONMENT[env]),
		}),
};
