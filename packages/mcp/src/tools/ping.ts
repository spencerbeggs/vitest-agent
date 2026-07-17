/**
 * `ping` MCP tool — Schema-driven implementation.
 *
 * Trivial liveness probe used to verify hot-patch reload of the MCP
 * server. Returns the canonical `pong` payload so callers can assert
 * a healthy round-trip.
 *
 * @packageDocumentation
 */

import { Schema } from "effect";
import { publicProcedure } from "../context.js";

export const PingResult = Schema.Struct({
	message: Schema.Literal("pong").annotate({
		description: "Constant `pong`. Presence confirms the MCP server responded.",
	}),
}).annotate({
	identifier: "PingResult",
	title: "ping result",
	description: "Liveness probe. Carries no data beyond the constant `pong` discriminant.",
});
export type PingResultType = Schema.Schema.Type<typeof PingResult>;

export const ping = publicProcedure.query(async (): Promise<PingResultType> => ({ message: "pong" as const }));
