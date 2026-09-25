// Consolidated `tdd_task` MCP tool — Schema-driven implementation.
//
// `start` and `end` mutate; `get` and `resume` read. Every action
// now returns a structured payload — `get` carries the full nested
// `TddTaskDetail` tree plus the `currentPhase` lookup, and `resume`
// carries a compact summary discriminated by `phaseAvailable`.

import { McpToolkit, ToolFailure, ToolOutputSchema, ToolRefusal } from "@effected/mcp";
import { DataReader, DataStore } from "@vitest-agent/engine";
import { GoalDetail } from "@vitest-agent/sdk";
import { Effect, Match, Option, Schema } from "effect";
import { Tool } from "effect/unstable/ai";
import { IdempotentReplayMarker } from "../utils/replay-marker.js";

const TddPhaseRow = Schema.Struct({
	id: Schema.Number,
	behaviorId: Schema.NullOr(Schema.Number),
	phase: Schema.String,
	startedAt: Schema.String,
	endedAt: Schema.NullOr(Schema.String),
	transitionReason: Schema.NullOr(Schema.String),
}).annotate({ identifier: "TddTaskPhaseRow" });

const TddArtifactDetailRow = Schema.Struct({
	id: Schema.Number,
	phaseId: Schema.Number,
	artifactKind: Schema.String,
	testCaseId: Schema.NullOr(Schema.Number),
	testRunId: Schema.NullOr(Schema.Number),
	recordedAt: Schema.String,
}).annotate({ identifier: "TddTaskArtifactRow" });

const TddTaskDetailSchema = Schema.Struct({
	tddTaskId: Schema.Number,
	sessionId: Schema.Number,
	goal: Schema.String,
	startedAt: Schema.String,
	endedAt: Schema.NullOr(Schema.String),
	outcome: Schema.NullOr(Schema.String),
	runId: Schema.NullOr(Schema.String),
	goals: Schema.Array(GoalDetail),
	phases: Schema.Array(TddPhaseRow),
	artifacts: Schema.Array(TddArtifactDetailRow),
}).annotate({ identifier: "TddTaskDetailSchema" });

const CurrentPhaseLookup = Schema.Struct({
	id: Schema.Number,
	phase: Schema.String,
	startedAt: Schema.String,
	behaviorId: Schema.NullOr(Schema.Number),
}).annotate({ identifier: "TddTaskCurrentPhaseLookup" });

const TddTaskStartOk = Schema.Struct({
	action: Schema.Literal("start"),
	tddTaskId: Schema.Number,
	goal: Schema.String,
	runId: Schema.optional(Schema.String),
	...IdempotentReplayMarker,
}).annotate({ identifier: "TddTaskStartOk" });

const TddTaskEndOk = Schema.Struct({
	action: Schema.Literal("end"),
	tddTaskId: Schema.Number,
	outcome: Schema.Literals(["succeeded", "blocked", "abandoned"]),
	...IdempotentReplayMarker,
}).annotate({ identifier: "TddTaskEndOk" });

const TddTaskGetFound = Schema.Struct({
	action: Schema.Literal("get"),
	found: Schema.Literal(true),
	task: TddTaskDetailSchema,
	currentPhase: Schema.NullOr(CurrentPhaseLookup),
}).annotate({ identifier: "TddTaskGetFound" });

const TddTaskGetMissing = Schema.Struct({
	action: Schema.Literal("get"),
	found: Schema.Literal(false),
	tddTaskId: Schema.Number,
}).annotate({ identifier: "TddTaskGetMissing" });

const TddTaskResumeFound = Schema.Struct({
	action: Schema.Literal("resume"),
	found: Schema.Literal(true),
	tddTaskId: Schema.Number,
	goal: Schema.String,
	status: Schema.String,
	currentPhase: Schema.NullOr(CurrentPhaseLookup),
	phasesRecorded: Schema.Number,
	artifactsRecorded: Schema.Number,
}).annotate({ identifier: "TddTaskResumeFound" });

const TddTaskResumeMissing = Schema.Struct({
	action: Schema.Literal("resume"),
	found: Schema.Literal(false),
	tddTaskId: Schema.Number,
}).annotate({ identifier: "TddTaskResumeMissing" });

export const TddTaskResult = ToolOutputSchema.objectRooted(
	Schema.Union([
		TddTaskStartOk,
		TddTaskEndOk,
		TddTaskGetFound,
		TddTaskGetMissing,
		TddTaskResumeFound,
		TddTaskResumeMissing,
	]),
).annotate({
	identifier: "TddTaskResult",
	title: "tdd_task result",
	description:
		"Discriminate on `action`. `get` and `resume` further discriminate on `found`. `get` carries the full nested task tree.",
});
export type TddTaskResultType = Schema.Schema.Type<typeof TddTaskResult>;

const StartVariant = Schema.Struct({
	action: Schema.Literal("start").annotate({ description: "Lifecycle discriminator" }),
	goal: Schema.String.annotate({ description: "start: goal text" }),
	sessionId: Schema.optionalKey(Schema.Finite).annotate({ description: "start: sessions.id (alternative to chatId)" }),
	chatId: Schema.optionalKey(Schema.String).annotate({ description: "start: host chat UUID" }),
	parentTddTaskId: Schema.optionalKey(Schema.Finite).annotate({
		description: "start: parent task id when decomposing",
	}),
	startedAt: Schema.optionalKey(Schema.String),
	runId: Schema.optionalKey(Schema.String),
});

const EndVariant = Schema.Struct({
	action: Schema.Literal("end").annotate({ description: "Lifecycle discriminator" }),
	tddTaskId: Schema.Finite.annotate({ description: "end/get/resume: tdd task id" }),
	outcome: Schema.Literals(["succeeded", "blocked", "abandoned"]).annotate({ description: "end: final outcome" }),
	summaryNoteId: Schema.optionalKey(Schema.Finite),
});

const GetVariant = Schema.Struct({
	action: Schema.Literal("get").annotate({ description: "Lifecycle discriminator" }),
	tddTaskId: Schema.Finite.annotate({ description: "end/get/resume: tdd task id" }),
});

const ResumeVariant = Schema.Struct({
	action: Schema.Literal("resume").annotate({ description: "Lifecycle discriminator" }),
	tddTaskId: Schema.Finite.annotate({ description: "end/get/resume: tdd task id" }),
});

/**
 * The `tdd_task` tool's parameters — a union discriminated on `action`.
 *
 * @public
 */
export const TddTaskInput = Schema.Union([StartVariant, EndVariant, GetVariant, ResumeVariant]);
/**
 * The decoded {@link TddTaskInput}.
 *
 * @public
 */
export type TddTaskInputType = Schema.Schema.Type<typeof TddTaskInput>;

/**
 * Single source of truth for the `tdd_task` tool's `action` discriminant.
 * `served-enum-drift.test.ts` asserts the served `oneOf` members match
 * this tuple exactly, so the wire enum cannot drift from the input union
 * (issue #335).
 */
export const TDD_TASK_ACTIONS = ["start", "end", "get", "resume"] as const;
type TddTaskAction = Schema.Schema.Type<typeof TddTaskInput>["action"];
type _AssertTddTaskActions = TddTaskAction extends (typeof TDD_TASK_ACTIONS)[number]
	? (typeof TDD_TASK_ACTIONS)[number] extends TddTaskAction
		? true
		: never
	: never;
const _assertTddTaskActions: _AssertTddTaskActions = true;
void _assertTddTaskActions;

/**
 * Handler for {@link tddTaskTool}. A `start` with neither `sessionId` nor
 * `chatId`, an unknown `sessionId` or `chatId`, or a blank `runId` fails with a
 * {@link ToolRefusal} (an `isError` result naming the fix). A store failure is
 * a defect.
 *
 * @public
 */
export const handleTddTask = (
	input: TddTaskInputType,
): Effect.Effect<TddTaskResultType, ToolRefusal, DataReader | DataStore> =>
	Match.value(input)
		.pipe(
			Match.discriminatorsExhaustive("action")({
				start: (variant) =>
					Effect.gen(function* () {
						const reader = yield* DataReader;
						const store = yield* DataStore;
						let sessionId: number;
						if (variant.sessionId !== undefined) {
							if (Option.isNone(yield* reader.getSessionById(variant.sessionId))) {
								return yield* Effect.fail(
									ToolRefusal.refuse(`Unknown sessionId ${variant.sessionId}.`, {
										hint: "Pass chatId (the host chat UUID) instead, or a sessionId that exists.",
									}),
								);
							}
							sessionId = variant.sessionId;
						} else if (variant.chatId !== undefined) {
							const opt = yield* reader.getSessionByChatId(variant.chatId);
							if (Option.isNone(opt)) {
								return yield* Effect.fail(
									ToolRefusal.refuse(
										`Unknown chatId ${ToolFailure.truncate(variant.chatId)}: no session is recorded for it.`,
										{
											hint: "The plugin's SessionStart hook records the session (vitest-agent agent record session-start); check that it ran for this chat, or pass a sessionId that exists.",
										},
									),
								);
							}
							sessionId = opt.value.id;
						} else {
							return yield* Effect.fail(
								ToolRefusal.refuse("tdd_task action='start' needs a session.", {
									hint: "Pass sessionId (sessions.id) or chatId (the host chat UUID).",
									suggestedTool: "tdd_task",
									suggestedArgs: { action: "start" },
								}),
							);
						}
						if (variant.runId !== undefined && variant.runId.trim().length === 0) {
							return yield* Effect.fail(
								ToolRefusal.refuse("tdd_task action='start': runId must not be blank.", {
									hint: "Omit runId, or pass a non-empty dispatch id.",
									suggestedTool: "tdd_task",
									suggestedArgs: { action: "start" },
								}),
							);
						}
						const tddTaskId = yield* store.writeTddTask({
							sessionId,
							goal: variant.goal,
							startedAt: variant.startedAt ?? new Date().toISOString(),
							...(variant.runId !== undefined && { runId: variant.runId }),
							...(variant.parentTddTaskId !== undefined && { parentTddTaskId: variant.parentTddTaskId }),
						});
						return {
							action: "start" as const,
							tddTaskId,
							goal: variant.goal,
							...(variant.runId !== undefined && { runId: variant.runId }),
						};
					}),
				end: (variant) =>
					Effect.gen(function* () {
						const store = yield* DataStore;
						yield* store.endTddTask({
							id: variant.tddTaskId,
							outcome: variant.outcome,
							endedAt: new Date().toISOString(),
							...(variant.summaryNoteId !== undefined && { summaryNoteId: variant.summaryNoteId }),
						});
						return { action: "end" as const, tddTaskId: variant.tddTaskId, outcome: variant.outcome };
					}),
				get: (variant) =>
					Effect.gen(function* () {
						const reader = yield* DataReader;
						const opt = yield* reader.getTddTaskById(variant.tddTaskId);
						if (Option.isNone(opt))
							return { action: "get" as const, found: false as const, tddTaskId: variant.tddTaskId };
						const currentOpt = yield* reader.getCurrentTddPhase(variant.tddTaskId);
						const { id, ...rest } = opt.value;
						return {
							action: "get" as const,
							found: true as const,
							task: { tddTaskId: id, ...rest },
							currentPhase: Option.match(currentOpt, {
								onNone: () => null,
								onSome: (p) => ({
									id: p.id,
									phase: p.phase as string,
									startedAt: p.startedAt,
									behaviorId: p.behaviorId,
								}),
							}),
						};
					}),
				resume: (variant) =>
					Effect.gen(function* () {
						const reader = yield* DataReader;
						const tddOpt = yield* reader.getTddTaskById(variant.tddTaskId);
						if (Option.isNone(tddOpt))
							return { action: "resume" as const, found: false as const, tddTaskId: variant.tddTaskId };
						const tdd = tddOpt.value;
						const currentOpt = yield* reader.getCurrentTddPhase(variant.tddTaskId);
						return {
							action: "resume" as const,
							found: true as const,
							tddTaskId: tdd.id,
							goal: tdd.goal,
							status: tdd.outcome ?? "in progress",
							currentPhase: Option.match(currentOpt, {
								onNone: () => null,
								onSome: (p) => ({
									id: p.id,
									phase: p.phase as string,
									startedAt: p.startedAt,
									behaviorId: p.behaviorId,
								}),
							}),
							phasesRecorded: tdd.phases.length,
							artifactsRecorded: tdd.artifacts.length,
						};
					}),
			}),
		)
		.pipe(Effect.catchTag("DataStoreError", Effect.die));

/**
 * The Effect-native `tdd_task` tool.
 *
 * @public
 */
export const tddTaskTool = McpToolkit.unionTool("tdd_task", {
	description:
		"Use to manage a TDD task lifecycle, with an action discriminator: action='start' (goal, sessionId|chatId, parentTddTaskId?, startedAt?, runId?) opens a new task; action='end' (tddTaskId, outcome, summaryNoteId?) closes one; action='get' (tddTaskId) returns the full task detail; action='resume' (tddTaskId) returns a compact digest.",
	parameters: TddTaskInput,
	success: TddTaskResult,
	failure: ToolRefusal,
})
	.addDependency(DataReader)
	.addDependency(DataStore)
	.annotate(Tool.Title, "TDD task")
	.annotate(Tool.Readonly, false)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)
	.annotate(Tool.Idempotent, true);
