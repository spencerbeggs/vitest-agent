/**
 * Consolidated `tdd_behavior` MCP tool.
 *
 * Replaces `tdd_behavior_create`, `tdd_behavior_update`,
 * `tdd_behavior_delete`, `tdd_behavior_get`, and `tdd_behavior_list`
 * (the latter already had a goal/tdd_task scope discriminator that
 * folds into the action discriminator here as `list_by_goal` /
 * `list_by_tdd_task`).
 */

import { BehaviorDetail, BehaviorRow, DataReader, DataStore } from "@vitest-agent/sdk";
import { Effect, Match, Option, Schema } from "effect";
import { idempotentProcedure } from "../middleware/idempotency.js";
import { catchTddErrorsAsEnvelope } from "./_tdd-error-envelope.js";

const BehaviorStatus = Schema.Literals(["pending", "in_progress", "done", "abandoned"]);

const TddBehaviorErrorEnvelope = Schema.Struct({
	ok: Schema.Literal(false).annotate({ description: "Discriminant — `false` when a tagged TDD error was caught." }),
	error: Schema.StructWithRest(
		Schema.Struct({
			_tag: Schema.String.annotate({
				description: "Tagged error name (e.g. BehaviorNotFoundError, GoalNotFoundError).",
			}),
			message: Schema.String,
			remediation: Schema.optional(Schema.String),
		}),
		[Schema.Record(Schema.String, Schema.Unknown)],
	),
}).annotate({ identifier: "TddBehaviorErrorEnvelope" });

const TddBehaviorCreateOk = Schema.Struct({
	ok: Schema.Literal(true),
	action: Schema.Literal("create"),
	behavior: BehaviorRow.annotate({ description: "Newly inserted behavior row." }),
});

const TddBehaviorUpdateOk = Schema.Struct({
	ok: Schema.Literal(true),
	action: Schema.Literal("update"),
	behavior: BehaviorRow.annotate({ description: "Updated behavior row." }),
});

const TddBehaviorDeleteOk = Schema.Struct({
	ok: Schema.Literal(true),
	action: Schema.Literal("delete"),
	id: Schema.Number,
});

const TddBehaviorGetFound = Schema.Struct({
	action: Schema.Literal("get"),
	found: Schema.Literal(true),
	behavior: BehaviorDetail.annotate({ description: "Behavior with parentGoal + dependencies[]." }),
});

const TddBehaviorGetMissing = Schema.Struct({
	action: Schema.Literal("get"),
	found: Schema.Literal(false),
	id: Schema.Number,
});

const TddBehaviorListByGoalOk = Schema.Struct({
	ok: Schema.Literal(true),
	action: Schema.Literal("list_by_goal"),
	goalId: Schema.Number,
	behaviors: Schema.Array(BehaviorRow),
});

const TddBehaviorListByTddTaskOk = Schema.Struct({
	ok: Schema.Literal(true),
	action: Schema.Literal("list_by_tdd_task"),
	tddTaskId: Schema.Number,
	behaviors: Schema.Array(BehaviorRow),
});

export const TddBehaviorResult = Schema.Union([
	TddBehaviorCreateOk,
	TddBehaviorUpdateOk,
	TddBehaviorDeleteOk,
	TddBehaviorGetFound,
	TddBehaviorGetMissing,
	TddBehaviorListByGoalOk,
	TddBehaviorListByTddTaskOk,
	TddBehaviorErrorEnvelope,
]).annotate({
	identifier: "TddBehaviorResult",
	title: "tdd_behavior result",
	description: "Discriminate on `action` (or `ok=false` for the tagged-error envelope).",
});

const CreateVariant = Schema.Struct({
	action: Schema.Literal("create"),
	goalId: Schema.Number,
	behavior: Schema.String,
	suggestedTestName: Schema.optional(Schema.String),
	dependsOnBehaviorIds: Schema.optional(Schema.Array(Schema.Number)),
});

const UpdateVariant = Schema.Struct({
	action: Schema.Literal("update"),
	id: Schema.Number,
	behavior: Schema.optional(Schema.String),
	suggestedTestName: Schema.optional(Schema.NullOr(Schema.String)),
	status: Schema.optional(BehaviorStatus),
	dependsOnBehaviorIds: Schema.optional(Schema.Array(Schema.Number)),
});

const DeleteVariant = Schema.Struct({
	action: Schema.Literal("delete"),
	id: Schema.Number,
});

const GetVariant = Schema.Struct({
	action: Schema.Literal("get"),
	id: Schema.Number,
});

const ListByGoalVariant = Schema.Struct({
	action: Schema.Literal("list_by_goal"),
	goalId: Schema.Number,
});

const ListByTddTaskVariant = Schema.Struct({
	action: Schema.Literal("list_by_tdd_task"),
	tddTaskId: Schema.Number,
});

const TddBehaviorInput = Schema.Union([
	CreateVariant,
	UpdateVariant,
	DeleteVariant,
	GetVariant,
	ListByGoalVariant,
	ListByTddTaskVariant,
]);

export const tddBehavior = idempotentProcedure
	.input(Schema.toStandardSchemaV1(TddBehaviorInput))
	.mutation(async ({ ctx, input }) => {
		return ctx.runtime.runPromise(
			Match.value(input).pipe(
				Match.discriminatorsExhaustive("action")({
					create: (variant) =>
						catchTddErrorsAsEnvelope(
							Effect.gen(function* () {
								const store = yield* DataStore;
								const behavior = yield* store.createBehavior({
									goalId: variant.goalId,
									behavior: variant.behavior,
									...(variant.suggestedTestName !== undefined && { suggestedTestName: variant.suggestedTestName }),
									...(variant.dependsOnBehaviorIds !== undefined && {
										dependsOnBehaviorIds: variant.dependsOnBehaviorIds,
									}),
								});
								return { ok: true as const, action: "create" as const, behavior };
							}),
						),
					update: (variant) =>
						catchTddErrorsAsEnvelope(
							Effect.gen(function* () {
								const store = yield* DataStore;
								const behavior = yield* store.updateBehavior({
									id: variant.id,
									...(variant.behavior !== undefined && { behavior: variant.behavior }),
									...(variant.suggestedTestName !== undefined && { suggestedTestName: variant.suggestedTestName }),
									...(variant.status !== undefined && { status: variant.status }),
									...(variant.dependsOnBehaviorIds !== undefined && {
										dependsOnBehaviorIds: variant.dependsOnBehaviorIds,
									}),
								});
								return { ok: true as const, action: "update" as const, behavior };
							}),
						),
					delete: (variant) =>
						catchTddErrorsAsEnvelope(
							Effect.gen(function* () {
								const store = yield* DataStore;
								yield* store.deleteBehavior(variant.id);
								return { ok: true as const, action: "delete" as const, id: variant.id };
							}),
						),
					get: (variant) =>
						Effect.gen(function* () {
							const reader = yield* DataReader;
							const opt = yield* reader.getBehaviorById(variant.id);
							return Option.isNone(opt)
								? { action: "get" as const, found: false as const, id: variant.id }
								: { action: "get" as const, found: true as const, behavior: opt.value };
						}),
					list_by_goal: (variant) =>
						catchTddErrorsAsEnvelope(
							Effect.gen(function* () {
								const store = yield* DataStore;
								const reader = yield* DataReader;
								yield* store.listBehaviorsByGoal(variant.goalId);
								const behaviors = yield* reader.getBehaviorsByGoal(variant.goalId);
								return {
									ok: true as const,
									action: "list_by_goal" as const,
									goalId: variant.goalId,
									behaviors,
								};
							}),
						),
					list_by_tdd_task: (variant) =>
						catchTddErrorsAsEnvelope(
							Effect.gen(function* () {
								const store = yield* DataStore;
								const reader = yield* DataReader;
								yield* store.listBehaviorsByTddTask(variant.tddTaskId);
								const behaviors = yield* reader.getBehaviorsByTddTask(variant.tddTaskId);
								return {
									ok: true as const,
									action: "list_by_tdd_task" as const,
									tddTaskId: variant.tddTaskId,
									behaviors,
								};
							}),
						),
				}),
			),
		);
	});
