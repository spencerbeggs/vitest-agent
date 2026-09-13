// `ping` MCP tool — Schema-driven implementation.
//
// Trivial liveness probe used to verify hot-patch reload of the MCP
// server. Returns the canonical `pong` payload so callers can assert
// a healthy round-trip.

import { Effect, Schema } from "effect";
import { Tool } from "effect/unstable/ai";

/**
 * The `ping` tool's success payload.
 *
 * @public
 */
export const PingResult = Schema.Struct({
	message: Schema.Literal("pong").annotate({
		description: "Constant `pong`. Presence confirms the MCP server responded.",
	}),
}).annotate({
	identifier: "PingResult",
	title: "ping result",
	description: "Liveness probe. Carries no data beyond the constant `pong` discriminant.",
});
/**
 * The decoded {@link PingResult}.
 *
 * @public
 */
export type PingResultType = Schema.Schema.Type<typeof PingResult>;

/**
 * The Effect-native `ping` tool. No parameters (the default
 * `Tool.EmptyParams` serves as a strict empty object; `Schema.Struct({})`
 * would serialize to a non-object JSON Schema that MCP rejects).
 *
 * @public
 */
export const pingTool = Tool.make("ping", {
	description: "Ping the MCP server — returns 'pong'. Used to verify hot-patch reload.",
	success: PingResult,
})
	.annotate(Tool.Title, "Ping")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)
	.annotate(Tool.Idempotent, true);

/**
 * Handler for {@link pingTool}.
 *
 * @public
 */
export const handlePing = (): Effect.Effect<PingResultType> => Effect.succeed({ message: "pong" as const });
