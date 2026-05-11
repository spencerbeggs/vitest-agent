/**
 * Consolidated `tdd_goal` MCP tool.
 *
 * Replaces `tdd_goal_create`, `tdd_goal_update`, `tdd_goal_delete`,
 * `tdd_goal_get`, and `tdd_goal_list` with a single tool keyed on
 * `action`. All five tagged TDD errors are caught and surfaced as
 * `{ ok: false, error: { _tag, ..., remediation } }` envelopes via
 * the shared helper.
 */

import { Effect, Match, Option, Schema } from "effect";
import { DataReader, DataStore, GoalDetail, GoalRow } from "vitest-agent-sdk";
import { idempotentProcedure } from "../middleware/idempotency.js";
import { catchTddErrorsAsEnvelope } from "./_tdd-error-envelope.js";

const GoalStatus = Schema.Literal("pending", "in_progress", "done", "abandoned");

const TddErrorEnvelope = Schema.Struct({
	ok: Schema.Literal(false).annotations({ description: "Discriminant — `false` when a tagged TDD error was caught." }),
	error: Schema.Struct({
		_tag: Schema.String.annotations({
			description: "Tagged error name (e.g. GoalNotFoundError, TddTaskNotFoundError).",
		}),
		message: Schema.String,
		remediation: Schema.optional(Schema.String).annotations({ description: "Suggested next action when known." }),
	}).pipe(Schema.extend(Schema.Record({ key: Schema.String, value: Schema.Unknown }))),
}).annotations({ identifier: "TddErrorEnvelope" });

const TddGoalCreateOk = Schema.Struct({
	ok: Schema.Literal(true),
	action: Schema.Literal("create"),
	goal: GoalRow.annotations({ description: "Newly inserted goal row." }),
}).annotations({ identifier: "TddGoalCreateOk" });

const TddGoalUpdateOk = Schema.Struct({
	ok: Schema.Literal(true),
	action: Schema.Literal("update"),
	goal: GoalRow.annotations({ description: "Updated goal row." }),
}).annotations({ identifier: "TddGoalUpdateOk" });

const TddGoalDeleteOk = Schema.Struct({
	ok: Schema.Literal(true),
	action: Schema.Literal("delete"),
	id: Schema.Number,
}).annotations({ identifier: "TddGoalDeleteOk" });

const TddGoalGetFound = Schema.Struct({
	action: Schema.Literal("get"),
	found: Schema.Literal(true),
	goal: GoalDetail.annotations({ description: "Goal with nested behaviors[]." }),
}).annotations({ identifier: "TddGoalGetFound" });

const TddGoalGetMissing = Schema.Struct({
	action: Schema.Literal("get"),
	found: Schema.Literal(false),
	id: Schema.Number,
}).annotations({ identifier: "TddGoalGetMissing" });

const TddGoalListOk = Schema.Struct({
	ok: Schema.Literal(true),
	action: Schema.Literal("list"),
	tddTaskId: Schema.Number,
	goals: Schema.Array(GoalDetail).annotations({ description: "All goals for the TDD task, with their behaviors." }),
}).annotations({ identifier: "TddGoalListOk" });

export const TddGoalResult = Schema.Union(
	TddGoalCreateOk,
	TddGoalUpdateOk,
	TddGoalDeleteOk,
	TddGoalGetFound,
	TddGoalGetMissing,
	TddGoalListOk,
	TddErrorEnvelope,
).annotations({
	identifier: "TddGoalResult",
	title: "tdd_goal result",
	description:
		"Discriminate first on `action` (or on `ok=false` for the tagged-error envelope). Get returns `found:true|false`; create/update/delete/list return `ok:true` on success.",
});

const CreateVariant = Schema.Struct({
	action: Schema.Literal("create"),
	tddTaskId: Schema.Number,
	goal: Schema.String,
});

const UpdateVariant = Schema.Struct({
	action: Schema.Literal("update"),
	id: Schema.Number,
	goal: Schema.optional(Schema.String),
	status: Schema.optional(GoalStatus),
});

const DeleteVariant = Schema.Struct({
	action: Schema.Literal("delete"),
	id: Schema.Number,
});

const GetVariant = Schema.Struct({
	action: Schema.Literal("get"),
	id: Schema.Number,
});

const ListVariant = Schema.Struct({
	action: Schema.Literal("list"),
	tddTaskId: Schema.Number,
});

const TddGoalInput = Schema.Union(CreateVariant, UpdateVariant, DeleteVariant, GetVariant, ListVariant);

export const tddGoal = idempotentProcedure
	.input(Schema.standardSchemaV1(TddGoalInput))
	.mutation(async ({ ctx, input }) => {
		return ctx.runtime.runPromise(
			Match.value(input).pipe(
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
			),
		);
	});
