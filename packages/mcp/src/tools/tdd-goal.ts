/**
 * Consolidated `tdd_goal` MCP tool.
 *
 * Replaces `tdd_goal_create`, `tdd_goal_update`, `tdd_goal_delete`,
 * `tdd_goal_get`, and `tdd_goal_list` with a single tool keyed on
 * `action`. All five tagged TDD errors are caught and surfaced as
 * `{ ok: false, error: { _tag, ..., remediation } }` envelopes via
 * the shared helper.
 */

import { DataReader, DataStore } from "@vitest-agent/engine";
import { GoalDetail, GoalRow } from "@vitest-agent/sdk";
import { Effect, Match, Option, Schema } from "effect";
import { Tool } from "effect/unstable/ai";
import { IdempotentReplayMarker } from "../utils/replay-marker.js";
import { catchTddErrorsAsEnvelope } from "./_tdd-error-envelope.js";

const GoalStatus = Schema.Literals(["pending", "in_progress", "done", "abandoned"]);

const TddErrorEnvelope = Schema.Struct({
	ok: Schema.Literal(false).annotate({ description: "Discriminant — `false` when a tagged TDD error was caught." }),
	error: Schema.StructWithRest(
		Schema.Struct({
			_tag: Schema.String.annotate({
				description: "Tagged error name (e.g. GoalNotFoundError, TddTaskNotFoundError).",
			}),
			remediation: Schema.Struct({
				suggestedTool: Schema.String,
				suggestedArgs: Schema.Record(Schema.String, Schema.Unknown),
				humanHint: Schema.String,
			}).annotate({
				description: "Suggested next action: the tool to call, its arguments, and a plain-language hint.",
			}),
		}),
		[Schema.Record(Schema.String, Schema.Unknown)],
	),
}).annotate({ identifier: "TddErrorEnvelope" });

const TddGoalCreateOk = Schema.Struct({
	ok: Schema.Literal(true),
	action: Schema.Literal("create"),
	goal: GoalRow.annotate({ description: "Newly inserted goal row." }),
	...IdempotentReplayMarker,
}).annotate({ identifier: "TddGoalCreateOk" });

const TddGoalUpdateOk = Schema.Struct({
	ok: Schema.Literal(true),
	action: Schema.Literal("update"),
	goal: GoalRow.annotate({ description: "Updated goal row." }),
}).annotate({ identifier: "TddGoalUpdateOk" });

const TddGoalDeleteOk = Schema.Struct({
	ok: Schema.Literal(true),
	action: Schema.Literal("delete"),
	id: Schema.Number,
}).annotate({ identifier: "TddGoalDeleteOk" });

const TddGoalGetFound = Schema.Struct({
	action: Schema.Literal("get"),
	found: Schema.Literal(true),
	goal: GoalDetail.annotate({ description: "Goal with nested behaviors[]." }),
}).annotate({ identifier: "TddGoalGetFound" });

const TddGoalGetMissing = Schema.Struct({
	action: Schema.Literal("get"),
	found: Schema.Literal(false),
	id: Schema.Number,
}).annotate({ identifier: "TddGoalGetMissing" });

const TddGoalListOk = Schema.Struct({
	ok: Schema.Literal(true),
	action: Schema.Literal("list"),
	tddTaskId: Schema.Number,
	goals: Schema.Array(GoalDetail).annotate({ description: "All goals for the TDD task, with their behaviors." }),
}).annotate({ identifier: "TddGoalListOk" });

export const TddGoalResult = Schema.Union([
	TddGoalCreateOk,
	TddGoalUpdateOk,
	TddGoalDeleteOk,
	TddGoalGetFound,
	TddGoalGetMissing,
	TddGoalListOk,
	TddErrorEnvelope,
]).annotate({
	identifier: "TddGoalResult",
	title: "tdd_goal result",
	description:
		"Discriminate first on `action` (or on `ok=false` for the tagged-error envelope). Get returns `found:true|false`; create/update/delete/list return `ok:true` on success.",
});
/**
 * The decoded {@link TddGoalResult}.
 *
 * @public
 */
export type TddGoalResultType = Schema.Schema.Type<typeof TddGoalResult>;

const CreateVariant = Schema.Struct({
	action: Schema.Literal("create").annotate({ description: "CRUD discriminator" }),
	tddTaskId: Schema.Finite.annotate({ description: "create/list: tdd task id" }),
	goal: Schema.String,
});

const UpdateVariant = Schema.Struct({
	action: Schema.Literal("update").annotate({ description: "CRUD discriminator" }),
	id: Schema.Finite.annotate({ description: "update/delete/get: goal id" }),
	goal: Schema.optionalKey(Schema.String),
	status: Schema.optionalKey(GoalStatus),
});

const DeleteVariant = Schema.Struct({
	action: Schema.Literal("delete").annotate({ description: "CRUD discriminator" }),
	id: Schema.Finite.annotate({ description: "update/delete/get: goal id" }),
});

const GetVariant = Schema.Struct({
	action: Schema.Literal("get").annotate({ description: "CRUD discriminator" }),
	id: Schema.Finite.annotate({ description: "update/delete/get: goal id" }),
});

const ListVariant = Schema.Struct({
	action: Schema.Literal("list").annotate({ description: "CRUD discriminator" }),
	tddTaskId: Schema.Finite.annotate({ description: "create/list: tdd task id" }),
});

/**
 * The `tdd_goal` tool's parameters — a union discriminated on `action`.
 *
 * @public
 */
export const TddGoalInput = Schema.Union([CreateVariant, UpdateVariant, DeleteVariant, GetVariant, ListVariant]);
/**
 * The decoded {@link TddGoalInput}.
 *
 * @public
 */
export type TddGoalInputType = Schema.Schema.Type<typeof TddGoalInput>;

/**
 * Single source of truth for the `tdd_goal` tool's `action` discriminant.
 * `served-enum-drift.test.ts` asserts the served `oneOf` members match
 * this tuple exactly, so the wire enum cannot drift from the input union
 * (issue #335).
 */
export const TDD_GOAL_ACTIONS = ["create", "update", "delete", "get", "list"] as const;
type TddGoalAction = Schema.Schema.Type<typeof TddGoalInput>["action"];
type _AssertTddGoalActions = TddGoalAction extends (typeof TDD_GOAL_ACTIONS)[number]
	? (typeof TDD_GOAL_ACTIONS)[number] extends TddGoalAction
		? true
		: never
	: never;
const _assertTddGoalActions: _AssertTddGoalActions = true;
void _assertTddGoalActions;

/**
 * Handler for {@link tddGoalTool}. The five tagged TDD errors come back as
 * the `{ ok: false, error }` envelope; anything else is a defect.
 *
 * @public
 */
export const handleTddGoal = (
	input: TddGoalInputType,
): Effect.Effect<TddGoalResultType, never, DataReader | DataStore> =>
	Match.value(input)
		.pipe(
			Match.discriminatorsExhaustive("action")({
				create: (variant) =>
					catchTddErrorsAsEnvelope(
						Effect.gen(function* () {
							const store = yield* DataStore;
							const goal = yield* store.createGoal({ tddTaskId: variant.tddTaskId, goal: variant.goal });
							return { ok: true as const, action: "create" as const, goal };
						}),
					),
				update: (variant) =>
					catchTddErrorsAsEnvelope(
						Effect.gen(function* () {
							const store = yield* DataStore;
							const goal = yield* store.updateGoal({
								id: variant.id,
								...(variant.goal !== undefined && { goal: variant.goal }),
								...(variant.status !== undefined && { status: variant.status }),
							});
							return { ok: true as const, action: "update" as const, goal };
						}),
					),
				delete: (variant) =>
					catchTddErrorsAsEnvelope(
						Effect.gen(function* () {
							const store = yield* DataStore;
							yield* store.deleteGoal(variant.id);
							return { ok: true as const, action: "delete" as const, id: variant.id };
						}),
					),
				get: (variant) =>
					Effect.gen(function* () {
						const reader = yield* DataReader;
						const opt = yield* reader.getGoalById(variant.id);
						return Option.isNone(opt)
							? { action: "get" as const, found: false as const, id: variant.id }
							: { action: "get" as const, found: true as const, goal: opt.value };
					}),
				list: (variant) =>
					catchTddErrorsAsEnvelope(
						Effect.gen(function* () {
							const store = yield* DataStore;
							const reader = yield* DataReader;
							yield* store.listGoalsByTddTask(variant.tddTaskId);
							const goals = yield* reader.getGoalsByTddTask(variant.tddTaskId);
							return { ok: true as const, action: "list" as const, tddTaskId: variant.tddTaskId, goals };
						}),
					),
			}),
		)
		.pipe(Effect.orDie);

/**
 * The Effect-native `tdd_goal` tool.
 *
 * @public
 */
export const tddGoalTool = Tool.make("tdd_goal", {
	description:
		"Use to manage TDD goals, with a CRUD action discriminator: action='create' (tddTaskId, goal) is idempotent on (tddTaskId, goal); action='update' (id, goal?, status?) edits text and/or lifecycle status; action='delete' (id) hard-deletes (prefer status:'abandoned'); action='get' (id) reads with nested behaviors; action='list' (tddTaskId) returns all goals for a TDD task.",
	parameters: TddGoalInput,
	success: TddGoalResult,
	dependencies: [DataReader, DataStore],
})
	.annotate(Tool.Title, "TDD goal")
	.annotate(Tool.Readonly, false)
	.annotate(Tool.Destructive, true)
	.annotate(Tool.OpenWorld, false)
	.annotate(Tool.Idempotent, false);
