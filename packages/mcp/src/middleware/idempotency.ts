import { Effect, Option } from "effect";
import { DataReader, DataStore } from "vitest-agent-sdk";
import { middleware, publicProcedure } from "../context.js";

// ---------------------------------------------------------------------------
// Key derivation registry
// ---------------------------------------------------------------------------

/**
 * Specifies how to derive the idempotency key for a given procedure path
 * from the raw (pre-parsed) input object.
 */
export interface IdempotencyKeySpec {
	/** The exact tRPC procedure path (e.g. "hypothesis_record"). */
	readonly procedurePath: string;
	/** Derives a stable string key from the raw input. */
	readonly deriveKey: (input: unknown) => string | null;
}

/**
 * Registered idempotency specs for mutation procedures.
 *
 * Two RC procedures are covered:
 *   - `hypothesis_record`   key: `${sessionId}:${content}`
 *   - `hypothesis_validate` key: `${id}:${outcome}`
 *
 * Add an entry here whenever a new idempotent mutation is introduced.
 */
export const idempotencyKeys: ReadonlyArray<IdempotencyKeySpec> = [
	{
		procedurePath: "hypothesis",
		deriveKey: (input) => {
			if (input === null || typeof input !== "object" || !("action" in input)) return null;
			const i = input as Record<string, unknown>;
			if (i.action === "record" && typeof i.sessionId === "number" && typeof i.content === "string") {
				return `record:${i.sessionId}:${i.content}`;
			}
			if (i.action === "validate" && typeof i.id === "number" && typeof i.outcome === "string") {
				return `validate:${i.id}:${i.outcome}`;
			}
			return null;
		},
	},
	{
		procedurePath: "_legacy_hypothesis_validate",
		deriveKey: (input) => {
			if (
				input !== null &&
				typeof input === "object" &&
				"id" in input &&
				"outcome" in input &&
				typeof (input as Record<string, unknown>).id === "number" &&
				typeof (input as Record<string, unknown>).outcome === "string"
			) {
				const i = input as { id: number; outcome: string };
				return `${i.id}:${i.outcome}`;
			}
			return null;
		},
	},
	{
		// `tdd_task action=start` accepts either `sessionId` (sessions.id)
		// or `chatId` (host chat id). Both forms must produce a stable
		// key — without that, an orchestrator retry that uses the same
		// identifier form will silently bypass the cache and create a
		// duplicate `tdd_tasks` row, which is exactly what idempotency
		// is here to prevent. We key on whichever id is present, prefixed
		// with its kind so a hypothetical chat-X id can't collide with
		// integer id X.
		//
		// When `runId` is present (new-style dispatch), key on the run id
		// instead of the goal text. This lets the same goal be retried in
		// the same chat by generating a new runId at dispatch time.
		// Backward compat: callers that omit runId fall back to goal-based
		// keying so existing tests and old-style tool calls still work.
		procedurePath: "tdd_task",
		deriveKey: (input) => {
			if (input === null || typeof input !== "object" || !("action" in input)) return null;
			const i = input as Record<string, unknown>;
			if (i.action === "start" && typeof i.goal === "string") {
				if (typeof i.runId === "string") {
					if (typeof i.sessionId === "number") return `start:sid:${i.sessionId}:run:${i.runId}`;
					if (typeof i.chatId === "string") return `start:chat:${i.chatId}:run:${i.runId}`;
				}
				if (typeof i.sessionId === "number") return `start:sid:${i.sessionId}:${i.goal}`;
				if (typeof i.chatId === "string") return `start:chat:${i.chatId}:${i.goal}`;
			}
			if (i.action === "end" && typeof i.tddTaskId === "number" && typeof i.outcome === "string") {
				return `end:${i.tddTaskId}:${i.outcome}`;
			}
			return null;
		},
	},
	{
		procedurePath: "tdd_goal",
		deriveKey: (input) => {
			if (input === null || typeof input !== "object" || !("action" in input)) return null;
			const i = input as Record<string, unknown>;
			if (i.action === "create" && typeof i.tddTaskId === "number" && typeof i.goal === "string") {
				return `create:${i.tddTaskId}:${i.goal}`;
			}
			return null;
		},
	},
	{
		procedurePath: "tdd_behavior",
		deriveKey: (input) => {
			if (input === null || typeof input !== "object" || !("action" in input)) return null;
			const i = input as Record<string, unknown>;
			if (i.action === "create" && typeof i.goalId === "number" && typeof i.behavior === "string") {
				return `create:${i.goalId}:${i.behavior}`;
			}
			return null;
		},
	},
];

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
