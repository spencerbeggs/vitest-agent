import { Effect, Layer } from "effect";
import type { DetailLevel } from "../schemas/Common.js";
import { DetailResolver } from "../services/DetailResolver.js";
/** @public */
export const DetailResolverLive = Layer.succeed(DetailResolver, {
	resolve: (executor, health, explicit) =>
		Effect.succeed<DetailLevel>(
			explicit ??
				(executor === "agent" || executor === "ci"
					? "verbose"
					: health.hasFailures
						? "verbose"
						: health.belowTargets
							? "standard"
							: health.hasTargets === false
								? "neutral"
								: "minimal"),
		),
});
