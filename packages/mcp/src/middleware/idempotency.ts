import { DataReader, DataStore } from "@vitest-agent/engine";
import { Effect, Option } from "effect";
import { middleware, publicProcedure } from "../context.js";
import type { IdempotencyKeySpec } from "../idempotency.js";
import { idempotencyKeys } from "../idempotency.js";

export type { IdempotencyKeySpec };
export { idempotencyKeys };

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/** Lookup table keyed by procedure path for O(1) spec retrieval. */
const keySpecByPath = new Map<string, IdempotencyKeySpec>(idempotencyKeys.map((s) => [s.procedurePath, s]));

/**
 * tRPC middleware that caches mutation results in `mcp_idempotent_responses`.
 *
 * On every mutation call where the procedure path has a registered
 * `IdempotencyKeySpec`:
 *
 * 1. Derive the idempotency key from the raw input.
 * 2. Look up `DataReader.findIdempotentResponse(path, key)`.
 *    - Cache HIT  → return the stored JSON result immediately (no handler).
 *    - Cache MISS → call `next()` to run the handler, then persist the result
 *      via `DataStore.recordIdempotentResponse`. Persistence errors are
 *      swallowed (best-effort) so a transient DB failure doesn't surface to
 *      the caller as a tool error.
 *
 * Procedures without a registered spec, or where key derivation returns
 * `null`, pass straight through to `next()` without any caching.
 */
const idempotent = middleware(async (opts) => {
	const { ctx, path, type, getRawInput, next } = opts;

	// Only intercept mutations with a registered key spec.
	if (type !== "mutation") {
		return next();
	}

	const spec = keySpecByPath.get(path);
	if (!spec) {
		return next();
	}

	const rawInput = await getRawInput();
	const key = spec.deriveKey(rawInput);

	if (key === null) {
		// Key derivation failed (unexpected input shape); let handler decide.
		return next();
	}

	// Check cache.
	const cached = await ctx.runtime.runPromise(
		Effect.gen(function* () {
			const reader = yield* DataReader;
			return yield* reader.findIdempotentResponse(path, key);
		}),
	);

	if (Option.isSome(cached)) {
		// Return the cached result with the _idempotentReplay marker so callers
		// can distinguish a fresh result from a replay. Object payloads get the
		// flag merged in; non-object payloads pass through unchanged.
		const parsed: unknown = JSON.parse(cached.value);
		const dataWithMarker =
			parsed !== null && typeof parsed === "object"
				? { ...(parsed as Record<string, unknown>), _idempotentReplay: true }
				: parsed;
		return {
			ok: true as const,
			data: dataWithMarker,
			marker: "middlewareMarker" as never,
			ctx,
		};
	}

	// Cache miss — run the actual handler.
	const result = await next();

	if (result.ok) {
		// Persist best-effort; swallow errors so a write failure is invisible.
		await ctx.runtime.runPromise(
			Effect.gen(function* () {
				const store = yield* DataStore;
				yield* store.recordIdempotentResponse({
					procedurePath: path,
					key,
					resultJson: JSON.stringify(result.data),
					createdAt: new Date().toISOString(),
				});
			}).pipe(Effect.orElseSucceed(() => undefined)),
		);
	}

	return result;
});

/** Drop-in replacement for `publicProcedure` on idempotent mutations. */
export const idempotentProcedure = publicProcedure.use(idempotent);
