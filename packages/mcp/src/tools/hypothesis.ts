// Consolidated `hypothesis` MCP tool — Schema-driven implementation.
//
// `record` and `validate` are mutations whose result is a small
// structured envelope. `list` now returns a structured array; the
// boundary in server.ts renders it as markdown via the exported
// `formatHypothesisListMarkdown` helper.

import { DataReader, DataStore } from "@vitest-agent/engine";
import { DataStoreError } from "@vitest-agent/sdk";
import { Effect, Match, Option, Schema } from "effect";
import { Tool } from "effect/unstable/ai";
import { RenderText } from "../annotations.js";
import { McpSession } from "../session.js";
import { IdempotentReplayMarker } from "../utils/replay-marker.js";

const HypothesisRowSchema = Schema.Struct({
	id: Schema.Number,
	sessionId: Schema.Number,
	content: Schema.String.annotate({
		description: "Free-text hypothesis the agent recorded before attempting a fix.",
	}),
	citedTestErrorId: Schema.NullOr(Schema.Number).annotate({
		description: "Optional `test_errors.id` the hypothesis cites as the failing observation.",
	}),
	citedStackFrameId: Schema.NullOr(Schema.Number).annotate({
		description: "Optional `stack_frames.id` for the specific frame the hypothesis blames.",
	}),
	validationOutcome: Schema.NullOr(Schema.Literals(["confirmed", "refuted", "abandoned"])).annotate({
		description: "Outcome recorded by `hypothesis (action: validate)`; `null` while still open.",
	}),
	validatedAt: Schema.NullOr(Schema.String).annotate({
		description: "ISO-8601 validation timestamp; `null` while open.",
	}),
}).annotate({ identifier: "HypothesisRow" });

const HypothesisRecordOk = Schema.Struct({
	action: Schema.Literal("record"),
	id: Schema.Finite.annotate({ description: "Newly inserted hypothesis row primary key." }),
});

const HypothesisValidateOk = Schema.Struct({
	action: Schema.Literal("validate"),
	...IdempotentReplayMarker,
});

const HypothesisListOk = Schema.Struct({
	action: Schema.Literal("list"),
	count: Schema.Number,
	hypotheses: Schema.Array(HypothesisRowSchema),
});

export const HypothesisResult = Schema.Union([HypothesisRecordOk, HypothesisValidateOk, HypothesisListOk]).annotate({
	identifier: "HypothesisResult",
	title: "hypothesis result",
	description:
		"Discriminate on `action`. record returns the new id; list returns the matching rows; validate returns an empty acknowledgement.",
});
export type HypothesisResultType = Schema.Schema.Type<typeof HypothesisResult>;

export const formatHypothesisListMarkdown = (data: HypothesisResultType): string => {
	if (data.action !== "list") return JSON.stringify(data, null, 2);
	if (data.hypotheses.length === 0) return "No hypotheses matched.";
	const lines: string[] = ["# Hypotheses", ""];
	for (const h of data.hypotheses) {
		const status = h.validationOutcome ?? "open";
		lines.push(`- [${status}] id=${h.id} session=${h.sessionId}: ${h.content.slice(0, 120)}`);
	}
	return lines.join("\n");
};

/** Number-or-numeric-string id: LLM orchestrators routinely stringify numeric tool inputs. */
const CoercibleId = Schema.Union([Schema.Finite, Schema.FiniteFromString]);

/** The text channel: `list` renders markdown; `record` / `validate` render the pretty-printed JSON. */
const renderHypothesisText = (data: HypothesisResultType): string =>
	data.action === "list" ? formatHypothesisListMarkdown(data) : JSON.stringify(data, null, 2);

const RecordVariant = Schema.Struct({
	action: Schema.Literal("record").annotate({ description: "CRUD discriminator" }),
	// Preferred, deterministic binding: the orchestrator always holds an
	// unambiguous `tddTaskId` (returned by `tdd_task (action: start)`).
	// When supplied, the binding session is resolved server-side as the
	// session the task was opened under, ignoring the recovered host
	// context entirely. See the resolution block in the `record` handler.
	//
	// Accepts either a number or a numeric string, decoding to a number:
	// LLM orchestrators routinely stringify numeric tool inputs (a real
	// dogfood run passed `tddTaskId: "5"`), which a bare `Schema.Number`
	// rejects — silently dropping the deterministic branch and
	// misattributing the hypothesis. `FiniteFromString` (not
	// `NumberFromString`) is deliberate: it rejects `NaN`/`Infinity`, so a
	// genuinely non-numeric string like "abc" still fails validation
	// rather than coercing to `NaN`. Decoded type stays `number | undefined`.
	tddTaskId: Schema.optionalKey(CoercibleId).annotate({
		description:
			"record: tdd task id returned by tdd_task action='start' — binds the hypothesis to that task's session deterministically",
	}),
	// Fallback only, and in practice ignored during a live run: when no
	// `tddTaskId` is supplied the binding session is resolved from the
	// recovered host context (main session -> active subagent child). A
	// caller-supplied value is honored only when no host context is
	// recovered (dev / tests). See the resolution block in the handler.
	//
	// Same number-or-numeric-string coercion as `tddTaskId` above; decoded
	// type stays `number | undefined`.
	sessionId: Schema.optionalKey(CoercibleId).annotate({
		description:
			"list: filter by session id. record: dev/test fallback only — ignored when host context is recovered; never pass a tddTaskId value here",
	}),
	content: Schema.String.annotate({ description: "Hypothesis content (action=record)" }),
	createdTurnId: Schema.optionalKey(Schema.Finite),
	citedTestErrorId: Schema.optionalKey(Schema.Finite),
	citedStackFrameId: Schema.optionalKey(Schema.Finite),
});

const ValidateVariant = Schema.Struct({
	action: Schema.Literal("validate").annotate({ description: "CRUD discriminator" }),
	id: Schema.Finite.annotate({ description: "Hypothesis id (action=validate)" }),
	outcome: Schema.Literals(["confirmed", "refuted", "abandoned"]).annotate({
		description: "validate: 'confirmed'|'refuted'|'abandoned'; list filter may include 'open'",
	}),
	validatedTurnId: Schema.optionalKey(Schema.Finite),
	// Optional: when omitted, the validate handler defaults to the server's
	// current time (see the `validate` branch below) rather than requiring
	// the caller to synthesize a timestamp. An explicitly supplied value is
	// always honored verbatim.
	validatedAt: Schema.optionalKey(Schema.String).annotate({ description: "ISO 8601 timestamp (action=validate)" }),
});

const ListVariant = Schema.Struct({
	action: Schema.Literal("list").annotate({ description: "CRUD discriminator" }),
	sessionId: Schema.optionalKey(Schema.Finite).annotate({
		description:
			"list: filter by session id. record: dev/test fallback only — ignored when host context is recovered; never pass a tddTaskId value here",
	}),
	outcome: Schema.optionalKey(Schema.Literals(["confirmed", "refuted", "abandoned", "open"])).annotate({
		description: "validate: 'confirmed'|'refuted'|'abandoned'; list filter may include 'open'",
	}),
	limit: Schema.optionalKey(Schema.Finite),
});

/**
 * The `hypothesis` tool's parameters — a union discriminated on `action`.
 *
 * @public
 */
export const HypothesisInput = Schema.Union([RecordVariant, ValidateVariant, ListVariant]);
/**
 * The decoded {@link HypothesisInput}.
 *
 * @public
 */
export type HypothesisInputType = Schema.Schema.Type<typeof HypothesisInput>;

/**
 * Single source of truth for the `hypothesis` tool's `action` discriminant.
 * `served-enum-drift.test.ts` asserts the served `oneOf` members match
 * this tuple exactly, so the wire enum cannot drift from the input union
 * (issue #335).
 */
export const HYPOTHESIS_ACTIONS = ["record", "validate", "list"] as const;
type HypothesisAction = Schema.Schema.Type<typeof HypothesisInput>["action"];
type _AssertHypothesisActions = HypothesisAction extends (typeof HYPOTHESIS_ACTIONS)[number]
	? (typeof HYPOTHESIS_ACTIONS)[number] extends HypothesisAction
		? true
		: never
	: never;
const _assertHypothesisActions: _AssertHypothesisActions = true;
void _assertHypothesisActions;

/**
 * Handler for {@link hypothesisTool}. `record` fails (as a defect, so it
 * reaches the agent as the `UnexpectedToolError` envelope) when the
 * binding session cannot be resolved.
 *
 * @public
 */
export const handleHypothesis = (
	input: HypothesisInputType,
): Effect.Effect<HypothesisResultType, never, DataReader | DataStore | McpSession> =>
	Match.value(input)
		.pipe(
			Match.discriminatorsExhaustive("action")({
				record: (variant) =>
					Effect.gen(function* () {
						const store = yield* DataStore;
						const reader = yield* DataReader;
						const session = yield* McpSession;
						// Resolve the binding session server-side rather than trusting a
						// caller-guessed sessionId. Precedence:
						//
						//   1. tddTaskId (preferred, deterministic). The orchestrator
						//      always holds an unambiguous tddTaskId (returned by
						//      tdd_task action: start), so resolve the session the task
						//      was opened under and bind there — ignoring the recovered
						//      host context entirely. An unknown tddTaskId is a hard,
						//      typed failure (not a silent misattribution).
						//   2. Recovered host context (sc). The MCP server is one
						//      long-lived process whose recovered context always names
						//      the MAIN agent; hypotheses are written only by the
						//      orchestrator subagent, so the correct target is the main
						//      session's active (un-ended) subagent child, else the main
						//      session itself.
						//   3. Caller-supplied sessionId, honored only when no host
						//      context was recovered (dev / tests).
						let resolvedSessionId: number | undefined;
						if (variant.tddTaskId !== undefined) {
							const bound = yield* reader.getSessionByTddTaskId(variant.tddTaskId);
							if (Option.isNone(bound)) {
								return yield* Effect.fail(
									new DataStoreError({
										operation: "write",
										table: "hypotheses",
										reason: `unknown tddTaskId ${variant.tddTaskId}: no session found to attribute hypothesis`,
									}),
								);
							}
							resolvedSessionId = bound.value.id;
						} else {
							const sc = session.sessionContext.get();
							resolvedSessionId = variant.sessionId;
							if (sc !== null) {
								const main = yield* reader.getSessionByChatId(sc.chatId);
								if (Option.isSome(main)) {
									const sub = yield* reader.findActiveSubagentSession(main.value.id);
									resolvedSessionId = Option.isSome(sub) ? sub.value.id : main.value.id;
								}
							}
							if (resolvedSessionId === undefined) {
								return yield* Effect.fail(
									new DataStoreError({
										operation: "write",
										table: "hypotheses",
										reason:
											"no recovered session context: pass tddTaskId (the id returned by tdd_task action:start) to bind this hypothesis to your task's session — do not retry with a raw sessionId, and never pass tddTaskId under a sessionId key",
									}),
								);
							}
						}
						const id = yield* store.writeHypothesis({
							sessionId: resolvedSessionId,
							content: variant.content,
							...(variant.createdTurnId !== undefined && { createdTurnId: variant.createdTurnId }),
							...(variant.citedTestErrorId !== undefined && { citedTestErrorId: variant.citedTestErrorId }),
							...(variant.citedStackFrameId !== undefined && { citedStackFrameId: variant.citedStackFrameId }),
						});
						return { action: "record" as const, id };
					}),
				validate: (variant) =>
					Effect.gen(function* () {
						const store = yield* DataStore;
						yield* store.validateHypothesis({
							id: variant.id,
							outcome: variant.outcome,
							validatedAt: variant.validatedAt ?? new Date().toISOString(),
							...(variant.validatedTurnId !== undefined && { validatedTurnId: variant.validatedTurnId }),
						});
						return { action: "validate" as const };
					}),
				list: (variant) =>
					Effect.gen(function* () {
						const reader = yield* DataReader;
						const rows = yield* reader.listHypotheses({
							...(variant.sessionId !== undefined && { sessionId: variant.sessionId }),
							...(variant.outcome !== undefined && { outcome: variant.outcome }),
							...(variant.limit !== undefined && { limit: variant.limit }),
						});
						return { action: "list" as const, count: rows.length, hypotheses: rows };
					}),
			}),
		)
		.pipe(Effect.orDie);

/**
 * The Effect-native `hypothesis` tool.
 *
 * @public
 */
export const hypothesisTool = Tool.make("hypothesis", {
	description:
		"Use to manage debugging hypotheses, with a CRUD action discriminator: action='record' (content, tddTaskId?, optional citation ids) writes a hypothesis — the binding session is resolved server-side from the recovered host context (active TDD subagent, else main session); pass tddTaskId (returned by tdd_task action='start') to bind deterministically to that task's session, and do not pass sessionId when recording; action='validate' (id, outcome, validatedAt?) records a validation outcome — validatedAt is optional and defaults server-side to now when omitted, or is honored verbatim when supplied; action='list' (sessionId?, outcome?, limit?) returns matching hypotheses as markdown.",
	parameters: HypothesisInput,
	success: HypothesisResult,
	dependencies: [DataReader, DataStore, McpSession],
})
	.annotate(Tool.Title, "Hypothesis")
	.annotate(Tool.Readonly, false)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)
	.annotate(Tool.Idempotent, false)
	.annotate(RenderText, (encoded) => renderHypothesisText(encoded as HypothesisResultType));
