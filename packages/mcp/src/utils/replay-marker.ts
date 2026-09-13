// The `_idempotentReplay` field the `withIdempotency` combinator merges
// into a cached response. Spread into the success structs of every
// idempotently-wrapped tool so the wire encoder (which drops undeclared
// keys) keeps the marker in `structuredContent`.

import { Schema } from "effect";

/**
 * Fields to spread into a replayable success struct.
 *
 * @public
 */
export const IdempotentReplayMarker = {
	_idempotentReplay: Schema.optionalKey(Schema.Literal(true)).annotate({
		description:
			"Present (true) when this response was replayed from the idempotency cache instead of re-running the mutation.",
	}),
} as const;
