import type { Executor } from "@vitest-agent/sdk";
import { Effect, Layer } from "effect";
import { ExecutorResolver } from "../services/ExecutorResolver.js";
/** @public */
export const ExecutorResolverLive = Layer.succeed(ExecutorResolver, {
	resolve: (env) => Effect.succeed<Executor>(env === "agent-shell" ? "agent" : env === "terminal" ? "human" : "ci"),
});
