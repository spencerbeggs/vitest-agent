import type { CiName, RuntimeEnv } from "@effected/env";
import { Audience, CurrentRuntimeEnv } from "@effected/env";
import type { Environment } from "@vitest-agent/sdk";
import { Effect, Layer, Option } from "effect";
import { EnvironmentDetector } from "../services/EnvironmentDetector.js";

/** The engine environment for each CI `@effected/env` names; exhaustive over `CiName`. */
const CI_ENVIRONMENT: Record<CiName, Environment> = {
	"github-actions": "ci-github",
	generic: "ci-generic",
};

/**
 * Pure classification behind {@link EnvironmentDetectorLive}: an agent shell
 * wins, then GitHub Actions, then generic CI, else a terminal.
 *
 * @remarks
 * The agent/CI/human split is `@effected/env`'s `Audience.detect`, so the
 * engine and every `@effected/cli` front end agree on who is running; this
 * only refines CI into GitHub Actions versus any other CI.
 *
 * @param runtime - the `@effected/env` runtime snapshot to classify
 * @public
 */
export const classifyEnvironment = (runtime: RuntimeEnv): Environment => {
	switch (Audience.detect(runtime)) {
		case "agent":
			return "agent-shell";
		case "ci":
			return Option.match(runtime.ci, { onNone: () => "ci-generic", onSome: (ci) => CI_ENVIRONMENT[ci] });
		case "human":
			return "terminal";
	}
};

/**
 * Live environment detector over `@effected/env`'s `CurrentRuntimeEnv`, read
 * from the injected `env` map only: agent, GitHub Actions and generic CI
 * detection all come from `env`, never from the ambient process.
 *
 * @remarks
 * The snapshot is taken once, when the layer is built, through
 * `CurrentRuntimeEnv.layerFrom(env)`: a fresh layer per call and per use, so two
 * detectors built over different maps in one layer graph each see their own.
 *
 * @param env - the environment map to consult (the front end passes `process.env`)
 * @public
 */
export const EnvironmentDetectorLive = (env: Record<string, string | undefined>): Layer.Layer<EnvironmentDetector> =>
	Layer.effect(
		EnvironmentDetector,
		Effect.map(CurrentRuntimeEnv, (runtime) => {
			const environment = classifyEnvironment(runtime);
			return {
				detect: () => Effect.succeed(environment),
				isAgent: Effect.succeed(Option.isSome(runtime.agent)),
				agentName: Effect.succeed(Option.getOrUndefined(runtime.agent)),
			};
		}),
	).pipe(Layer.provide(CurrentRuntimeEnv.layerFrom(env)));
