/**
 * Consolidated `tdd_task` MCP tool — Schema-driven implementation.
 *
 * `start` and `end` mutate; `get` and `resume` read. Every action
 * now returns a structured payload — `get` carries the full nested
 * `TddTaskDetail` tree plus the `currentPhase` lookup, and `resume`
 * carries a compact summary discriminated by `phaseAvailable`. The
 * boundary in server.ts uses `formatTddTaskMarkdown` to render
 * `get` / `resume` text.
 *
 * @packageDocumentation
 */

import { DataReader, DataStore, GoalDetail } from "@vitest-agent/sdk";
import { Effect, Match, Option, Schema, SchemaGetter } from "effect";
import { idempotentProcedure } from "../middleware/idempotency.js";

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
}).annotate({ identifier: "TddTaskStartOk" });

const TddTaskEndOk = Schema.Struct({
	action: Schema.Literal("end"),
	tddTaskId: Schema.Number,
	outcome: Schema.Literals(["succeeded", "blocked", "abandoned"]),
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

export const TddTaskResult = Schema.Union([
	TddTaskStartOk,
	TddTaskEndOk,
	TddTaskGetFound,
	TddTaskGetMissing,
	TddTaskResumeFound,
	TddTaskResumeMissing,
]).annotate({
	identifier: "TddTaskResult",
	title: "tdd_task result",
	description:
		"Discriminate on `action`. `get` and `resume` further discriminate on `found`. `get` carries the full nested task tree.",
});
export type TddTaskResultType = Schema.Schema.Type<typeof TddTaskResult>;

export const formatTddTaskMarkdown = (data: TddTaskResultType): string => {
	if (data.action === "start" || data.action === "end") return JSON.stringify(data, null, 2);
	if (data.action === "get") {
		if (!data.found) return `No TDD task with tddTaskId=${data.tddTaskId}.`;
		const s = data.task;
		const currentPhaseLine =
			data.currentPhase === null
				? "- current phase: (none — no open phase)"
				: `- current phase: ${data.currentPhase.phase} [phaseId=${data.currentPhase.id}]${data.currentPhase.behaviorId !== null ? ` behaviorId=${data.currentPhase.behaviorId}` : ""}`;
		const lines: string[] = [
			`# TDD Task ${s.tddTaskId}`,
			"",
			`- goal: ${s.goal}`,
			`- run_id: ${s.runId ?? "(none — run_id not recorded)"}`,
			`- sessionId: ${s.sessionId}`,
			`- started: ${s.startedAt}`,
			`- ended: ${s.endedAt ?? "still open"}`,
			`- outcome: ${s.outcome ?? "pending"}`,
			currentPhaseLine,
		];
		if (s.phases.length > 0) {
			lines.push("", "## Phases", "");
			for (const p of s.phases) {
				const duration = p.endedAt ? ` -> ${p.endedAt}` : " (current)";
				lines.push(`- **${p.phase}** [id=${p.id}] ${p.startedAt}${duration}`);
				if (p.transitionReason !== null) lines.push(`  - reason: ${p.transitionReason}`);
			}
		}
		if (s.artifacts.length > 0) {
			lines.push("", "## Artifacts", "");
			for (const a of s.artifacts) {
				lines.push(
					`- **${a.artifactKind}** [id=${a.id}, phase=${a.phaseId}] at=${a.recordedAt}${a.testRunId !== null ? ` run=${a.testRunId}` : ""}`,
				);
			}
		}
		if (s.goals.length > 0) {
			lines.push("", "## Goals and Behaviors", "");
			for (const g of s.goals) {
				lines.push(`### Goal ${g.ordinal + 1}: ${g.goal} [${g.status}]`);
				if (g.behaviors.length > 0) {
					lines.push("");
					for (const b of g.behaviors) lines.push(`- **${b.behavior}** [${b.status}]`);
				}
				lines.push("");
			}
		}
		return lines.join("\n");
	}
	// resume
	if (!data.found) return `No TDD task with tddTaskId=${data.tddTaskId}.`;
	const lines: string[] = [`# TDD task #${data.tddTaskId}: ${data.goal}`, "", `**Status:** ${data.status}`];
	if (data.currentPhase !== null) {
		lines.push(`**Current phase:** ${data.currentPhase.phase} (started ${data.currentPhase.startedAt})`);
	} else {
		lines.push("**Current phase:** none (TDD cycle not yet entered)");
	}
	lines.push("", `**Phases recorded:** ${data.phasesRecorded}`);
	if (data.artifactsRecorded > 0) lines.push(`**Artifacts:** ${data.artifactsRecorded}`);
	lines.push(
		"",
		`Use \`tdd_task({ action: "get", tddTaskId: ${data.tddTaskId} })\` for the full detail tree, or call \`tdd_phase_transition_request\` to advance.`,
	);
	return lines.join("\n");
};

export const TddTaskAsMarkdown = TddTaskResult.pipe(
	Schema.decodeTo(Schema.String, {
		decode: SchemaGetter.transform((data) => formatTddTaskMarkdown(data)),
		encode: SchemaGetter.forbidden(() => "TddTaskAsMarkdown is one-way."),
	}),
);

const StartVariant = Schema.Struct({
	action: Schema.Literal("start"),
	goal: Schema.String,
	sessionId: Schema.optional(Schema.Number),
	chatId: Schema.optional(Schema.String),
	parentTddTaskId: Schema.optional(Schema.Number),
	startedAt: Schema.optional(Schema.String),
	runId: Schema.optional(Schema.String),
});

const EndVariant = Schema.Struct({
	action: Schema.Literal("end"),
	tddTaskId: Schema.Number,
	outcome: Schema.Literals(["succeeded", "blocked", "abandoned"]),
	summaryNoteId: Schema.optional(Schema.Number),
});

const GetVariant = Schema.Struct({
	action: Schema.Literal("get"),
	tddTaskId: Schema.Number,
});

const ResumeVariant = Schema.Struct({
	action: Schema.Literal("resume"),
	tddTaskId: Schema.Number,
});

const TddTaskInput = Schema.Union([StartVariant, EndVariant, GetVariant, ResumeVariant]);

export const tddTask = idempotentProcedure
	.input(Schema.toStandardSchemaV1(TddTaskInput))
	.mutation(async ({ ctx, input }): Promise<TddTaskResultType> => {
		return ctx.runtime.runPromise(
			Match.value(input).pipe(
				Match.discriminatorsExhaustive("action")({
					start: (variant) =>
						Effect.gen(function* () {
							const reader = yield* DataReader;
							const store = yield* DataStore;
							let sessionId: number;
							if (variant.sessionId !== undefined) {
								sessionId = variant.sessionId;
							} else if (variant.chatId !== undefined) {
								const opt = yield* reader.getSessionByChatId(variant.chatId);
								if (Option.isNone(opt)) {
									return yield* Effect.fail(
										new Error(`Unknown chatId: ${variant.chatId}. Run record session-start first.`),
									);
								}
								sessionId = opt.value.id;
							} else {
								return yield* Effect.fail(new Error("tdd_task action=start: provide sessionId or chatId"));
							}
							if (variant.runId !== undefined && variant.runId.trim().length === 0) {
								return yield* Effect.fail(new Error("tdd_task action=start: runId must not be blank"));
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
			),
		);
	});
