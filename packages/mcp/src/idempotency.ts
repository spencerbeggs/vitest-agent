// Idempotency as an Effect combinator: the key-derivation registry and
// `withIdempotency`, which wraps a write tool's handler so a replayed
// call returns the persisted first result (marked `_idempotentReplay`).

import { DataReader, DataStore } from "@vitest-agent/engine";
import { Effect, Option } from "effect";

// ---------------------------------------------------------------------------
// Key derivation registry
// ---------------------------------------------------------------------------

/**
 * Specifies how to derive the idempotency key for a given tool name from
 * the decoded (strictly-registered, so no key can have been stripped)
 * input object.
 *
 * @public
 */
export interface IdempotencyKeySpec {
	/** The served tool name (e.g. "hypothesis", "tdd_task"). */
	readonly procedurePath: string;
	/** Derives a stable string key from the decoded input. */
	readonly deriveKey: (input: unknown) => string | null;
}

/**
 * Registered idempotency specs for mutation tools.
 *
 * `hypothesis validate` is covered (key: `validate:${id}:${outcome}`).
 * `hypothesis record` is deliberately not covered — see the note in the
 * hypothesis spec below.
 *
 * Add an entry here whenever a new idempotent mutation is introduced.
 *
 * @public
 */
export const idempotencyKeys: ReadonlyArray<IdempotencyKeySpec> = [
	{
		procedurePath: "hypothesis",
		deriveKey: (input) => {
			if (input === null || typeof input !== "object" || !("action" in input)) return null;
			const i = input as Record<string, unknown>;
			// `record` is intentionally NOT idempotent. A hypothesis is an
			// append-only observation whose binding session is resolved
			// server-side (and so is absent from the input), leaving no safe
			// per-call discriminator: content-only keying collides across
			// different sessions / runs that record the same hypothesis text
			// and would replay a stale row under the wrong session. A genuine
			// retry creating a duplicate hypothesis row is harmless by
			// comparison.
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

/** Lookup table keyed by tool name for O(1) spec retrieval. */
const keySpecByPath = new Map<string, IdempotencyKeySpec>(idempotencyKeys.map((s) => [s.procedurePath, s]));

// ---------------------------------------------------------------------------
// Combinator
// ---------------------------------------------------------------------------

/** Merges the `_idempotentReplay` marker into an object payload; passes any other shape through unchanged. */
const withReplayMarker = (parsed: unknown): unknown =>
	parsed !== null && typeof parsed === "object"
		? { ...(parsed as Record<string, unknown>), _idempotentReplay: true }
		: parsed;

/**
 * Wraps `handler` with idempotent-response caching keyed on `path`.
 *
 * Semantics (unchanged from the retired tRPC middleware):
 *
 * 1. Look up the `IdempotencyKeySpec` registered for `path`, and
 *    derive a key from `params` (already decoded — strict registration
 *    guarantees no key was stripped). No registered spec, or a `null`
 *    key, runs `handler` untouched with nothing cached.
 * 2. Cache HIT — `DataReader.findIdempotentResponse` returns the stored
 *    JSON. A row that parses falls through to step 2a; a row that fails
 *    to parse (corrupt or truncated) is treated as step 3, a cache MISS —
 *    it is not a reason to fail the call.
 * 2a. The parsed value is merged with `_idempotentReplay: true` for an
 *    object payload (a non-object payload passes through unchanged).
 *    `handler` does not run.
 * 3. Cache MISS — run `handler`, then persist the result via
 *    `DataStore.recordIdempotentResponse` best-effort: a persistence
 *    failure (or a cache-lookup failure) never surfaces to the caller, it
 *    is swallowed so a transient DB failure doesn't turn into a tool
 *    error.
 *
 * The combinator reads no ambient state — `path` and `params` are its
 * only inputs beyond the `DataReader` / `DataStore` services it adds to
 * `handler`'s requirements.
 *
 * @public
 */
export const withIdempotency =
	<P, R, S>(path: string, handler: (params: P) => Effect.Effect<R, never, S>) =>
	(params: P): Effect.Effect<R | (R & { _idempotentReplay: true }), never, S | DataReader | DataStore> =>
		Effect.gen(function* () {
			const spec = keySpecByPath.get(path);
			const key = spec === undefined ? null : spec.deriveKey(params);
			if (key === null) {
				return yield* handler(params);
			}

			const reader = yield* DataReader;
			const cached = yield* reader
				.findIdempotentResponse(path, key)
				.pipe(Effect.orElseSucceed((): Option.Option<string> => Option.none()));

			if (Option.isSome(cached)) {
				const parsed = yield* Effect.try(() => JSON.parse(cached.value) as unknown).pipe(
					Effect.map(Option.some),
					Effect.orElseSucceed((): Option.Option<unknown> => Option.none()),
				);
				if (Option.isSome(parsed)) {
					return withReplayMarker(parsed.value) as R & { _idempotentReplay: true };
				}
				// Corrupt/unparseable row — fall through to the miss path below.
			}

			const result = yield* handler(params);
			const store = yield* DataStore;
			yield* store
				.recordIdempotentResponse({
					procedurePath: path,
					key,
					resultJson: JSON.stringify(result),
					createdAt: new Date().toISOString(),
				})
				.pipe(Effect.orElseSucceed(() => undefined));
			return result;
		});
