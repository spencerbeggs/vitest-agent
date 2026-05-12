import { Effect, Layer } from "effect";
import type { Executor } from "../schemas/Common.js";
import { ExecutorResolver } from "../services/ExecutorResolver.js";

export const ExecutorResolverLive = Layer.succeed(ExecutorResolver, {
	resolve: (env) => Effect.succeed<Executor>(env === "agent-shell" ? "agent" : env === "terminal" ? "human" : "ci"),
});
