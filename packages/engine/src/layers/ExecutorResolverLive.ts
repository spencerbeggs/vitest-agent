import type { AudienceKind } from "@effected/env";
import type { Environment, Executor } from "@vitest-agent/sdk";
import { Effect, Layer } from "effect";
import { ExecutorResolver } from "../services/ExecutorResolver.js";

/**
 * The `@effected/env` audience each environment implies. An `Executor` is the
 * same three-way split as an `AudienceKind` (`human` / `agent` / `ci`); typing
 * the table as `AudienceKind` and returning it as `Executor` keeps the two
 * unions from drifting apart at compile time.
 */
const AUDIENCE_OF: Readonly<Record<Environment, AudienceKind>> = {
	"agent-shell": "agent",
	terminal: "human",
	"ci-github": "ci",
	"ci-generic": "ci",
};

/** @public */
export const ExecutorResolverLive = Layer.succeed(ExecutorResolver, {
	resolve: (env) => Effect.succeed<Executor>(AUDIENCE_OF[env]),
});
