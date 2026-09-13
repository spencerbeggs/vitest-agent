/**
 * Consolidated `tdd_behavior` MCP tool.
 *
 * Replaces `tdd_behavior_create`, `tdd_behavior_update`,
 * `tdd_behavior_delete`, `tdd_behavior_get`, and `tdd_behavior_list`
 * (the latter already had a goal/tdd_task scope discriminator that
 * folds into the action discriminator here as `list_by_goal` /
 * `list_by_tdd_task`).
 */

import { DataReader, DataStore } from "@vitest-agent/engine";
import { BehaviorDetail, BehaviorRow } from "@vitest-agent/sdk";
import { Effect, Match, Option, Schema } from "effect";
import { Tool } from "effect/unstable/ai";
import { IdempotentReplayMarker } from "../utils/replay-marker.js";
import { catchTddErrorsAsEnvelope } from "./_tdd-error-envelope.js";

const BehaviorStatus = Schema.Literals(["pending", "in_progress", "done", "abandoned"]);

const TddBehaviorErrorEnvelope = Schema.Struct({
	ok: Schema.Literal(false).annotate({ description: "Discriminant — `false` when a tagged TDD error was caught." }),
	error: Schema.StructWithRest(
		Schema.Struct({
			_tag: Schema.String.annotate({
				description: "Tagged error name (e.g. BehaviorNotFoundError, GoalNotFoundError).",
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
}).annotate({ identifier: "TddBehaviorErrorEnvelope" });

const TddBehaviorCreateOk = Schema.Struct({
	ok: Schema.Literal(true),
	action: Schema.Literal("create"),
	behavior: BehaviorRow.annotate({ description: "Newly inserted behavior row." }),
	...IdempotentReplayMarker,
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
/**
 * The decoded {@link TddBehaviorResult}.
 *
 * @public
 */
export type TddBehaviorResultType = Schema.Schema.Type<typeof TddBehaviorResult>;

const CreateVariant = Schema.Struct({
	action: Schema.Literal("create").annotate({ description: "CRUD discriminator" }),
	goalId: Schema.Finite,
	behavior: Schema.String,
	suggestedTestName: Schema.optionalKey(Schema.String),
	dependsOnBehaviorIds: Schema.optionalKey(Schema.Array(Schema.Finite)),
});

const UpdateVariant = Schema.Struct({
	action: Schema.Literal("update").annotate({ description: "CRUD discriminator" }),
	id: Schema.Finite,
	behavior: Schema.optionalKey(Schema.String),
	suggestedTestName: Schema.optionalKey(Schema.NullOr(Schema.String)),
	status: Schema.optionalKey(BehaviorStatus),
	dependsOnBehaviorIds: Schema.optionalKey(Schema.Array(Schema.Finite)),
});

const DeleteVariant = Schema.Struct({
	action: Schema.Literal("delete").annotate({ description: "CRUD discriminator" }),
	id: Schema.Finite,
});

const GetVariant = Schema.Struct({
	action: Schema.Literal("get").annotate({ description: "CRUD discriminator" }),
	id: Schema.Finite,
});

const ListByGoalVariant = Schema.Struct({
	action: Schema.Literal("list_by_goal").annotate({ description: "CRUD discriminator" }),
	goalId: Schema.Finite,
});

const ListByTddTaskVariant = Schema.Struct({
	action: Schema.Literal("list_by_tdd_task").annotate({ description: "CRUD discriminator" }),
	tddTaskId: Schema.Finite,
});

/**
 * The `tdd_behavior` tool's parameters — a union discriminated on `action`.
 *
 * @public
 */
export const TddBehaviorInput = Schema.Union([
	CreateVariant,
	UpdateVariant,
	DeleteVariant,
	GetVariant,
	ListByGoalVariant,
	ListByTddTaskVariant,
]);
/**
 * The decoded {@link TddBehaviorInput}.
 *
 * @public
 */
export type TddBehaviorInputType = Schema.Schema.Type<typeof TddBehaviorInput>;

/**
 * Single source of truth for the `tdd_behavior` tool's `action` discriminant.
 * `served-enum-drift.test.ts` asserts the served `oneOf` members match
 * this tuple exactly, so the wire enum cannot drift from the input union
 * (issue #335).
 */
export const TDD_BEHAVIOR_ACTIONS = ["create", "update", "delete", "get", "list_by_goal", "list_by_tdd_task"] as const;
type TddBehaviorAction = Schema.Schema.Type<typeof TddBehaviorInput>["action"];
type _AssertTddBehaviorActions = TddBehaviorAction extends (typeof TDD_BEHAVIOR_ACTIONS)[number]
	? (typeof TDD_BEHAVIOR_ACTIONS)[number] extends TddBehaviorAction
		? true
		: never
	: never;
const _assertTddBehaviorActions: _AssertTddBehaviorActions = true;
void _assertTddBehaviorActions;

/**
 * Handler for {@link tddBehaviorTool}. The five tagged TDD errors come
 * back as the `{ ok: false, error }` envelope; anything else is a defect.
 *
 * @public
 */
export const handleTddBehavior = (
	input: TddBehaviorInputType,
): Effect.Effect<TddBehaviorResultType, never, DataReader | DataStore> =>
	Match.value(input)
		.pipe(
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
		)
		.pipe(Effect.orDie);

/**
 * The Effect-native `tdd_behavior` tool.
 *
 * @public
 */
export const tddBehaviorTool = Tool.make("tdd_behavior", {
	description:
		"Use to manage TDD behaviors, with a CRUD action discriminator: action='create' (goalId, behavior, suggestedTestName?, dependsOnBehaviorIds?) is idempotent on (goalId, behavior); action='update' (id, ...patch) edits; action='delete' (id) hard-deletes; action='get' (id) reads; action='list_by_goal' (goalId) lists one goal's behaviors; action='list_by_tdd_task' (tddTaskId) lists across all goals.",
	parameters: TddBehaviorInput,
	success: TddBehaviorResult,
	dependencies: [DataReader, DataStore],
})
	.annotate(Tool.Title, "TDD behavior")
	.annotate(Tool.Readonly, false)
	.annotate(Tool.Destructive, true)
	.annotate(Tool.OpenWorld, false)
	.annotate(Tool.Idempotent, false);
