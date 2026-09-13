import type { Environment } from "@vitest-agent/sdk";
import { Effect, Layer } from "effect";
import { agent, isAgent } from "std-env";
import { EnvironmentDetector } from "../services/EnvironmentDetector.js";

type Env = Record<string, string | undefined>;

const isGitHub = (env: Env): boolean => env.GITHUB_ACTIONS === "true" || env.GITHUB_ACTIONS === "1";

const isCI = (env: Env): boolean => isGitHub(env) || env.CI === "true";

/**
 * Pure classification behind {@link EnvironmentDetectorLive}: an agent shell
 * wins, then GitHub Actions, then generic CI, else a terminal.
 *
 * @param env - the environment map to consult
 * @param agentShell - whether the process runs under an AI agent (`std-env`'s `isAgent`)
 * @public
 */
export const classifyEnvironment = (env: Record<string, string | undefined>, agentShell: boolean): Environment => {
	if (agentShell) return "agent-shell";
	if (isGitHub(env)) return "ci-github";
	if (isCI(env)) return "ci-generic";
	return "terminal";
};

/**
 * Live environment detector. CI detection reads `GITHUB_ACTIONS` / `CI`
 * from the injected `env` map; agent detection comes from `std-env`.
 *
 * @param env - the environment map to consult (the front end passes `process.env`)
 * @public
 */
export const EnvironmentDetectorLive = (env: Record<string, string | undefined>): Layer.Layer<EnvironmentDetector> =>
	Layer.succeed(EnvironmentDetector, {
		detect: () => Effect.sync(() => classifyEnvironment(env, isAgent)),
		isAgent: Effect.sync(() => isAgent),
		agentName: Effect.sync(() => agent ?? undefined),
	});
