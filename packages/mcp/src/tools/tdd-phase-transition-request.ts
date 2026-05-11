import { Effect, Option, Schema } from "effect";
import type { ArtifactKind, Phase } from "vitest-agent-sdk";
import { DataReader, DataStore, requiredArtifactForTransition, validatePhaseTransition } from "vitest-agent-sdk";
import { publicProcedure } from "../context.js";

const phaseLiteral = Schema.Literal(
	"spike",
	"red",
	"red.triangulate",
	"green",
	"green.fake-it",
	"refactor",
	"extended-red",
	"green-without-red",
);

const artifactKindLiteral = Schema.Literal(
	"test_written",
	"test_failed_run",
	"code_written",
	"test_passed_run",
	"refactor",
	"test_weakened",
);

const denialReasonLiteral = Schema.Literal(
	"missing_artifact_evidence",
	"wrong_artifact_kind",
	"wrong_source_phase",
	"unknown_tdd_task",
	"tdd_task_already_ended",
	"goal_not_started",
	"goal_not_found",
	"goal_not_in_progress",
	"goal_not_in_tdd_task",
	"behavior_not_found",
	"behavior_not_in_goal",
	"refactor_without_passing_run",
	"evidence_not_in_phase_window",
	"evidence_not_for_behavior",
	"evidence_test_was_already_failing",
);

const RemediationSchema = Schema.Struct({
	suggestedTool: Schema.String.annotations({ description: "Next tool the agent should call to make progress." }),
	suggestedArgs: Schema.Record({ key: Schema.String, value: Schema.Unknown }).annotations({
		description: "Concrete arguments for `suggestedTool` that fix the underlying issue.",
	}),
	humanHint: Schema.String.annotations({ description: "Plain-language explanation of what to do next." }),
}).annotations({ identifier: "PhaseTransitionRemediation" });

const PhaseTransitionAccepted = Schema.Struct({
	accepted: Schema.Literal(true).annotations({ description: "Discriminant — `true` when the transition was granted." }),
	phase: phaseLiteral.annotations({ description: "Phase the session is now in (echo of `requestedPhase`)." }),
	newPhaseId: Schema.Number.annotations({ description: "`tdd_phases.id` of the freshly opened row." }),
	previousPhaseId: Schema.NullOr(Schema.Number).annotations({
		description: "`tdd_phases.id` of the phase that was closed (`null` for the first transition).",
	}),
	citedArtifactId: Schema.optional(Schema.Number).annotations({
		description:
			"Resolved `tdd_artifacts.id` actually used. Absent only for transitions that need no artifact (e.g. spike→red).",
	}),
	citedArtifactSource: Schema.optional(
		Schema.Literal("explicit-id", "explicit-kind", "transition-derived", "none"),
	).annotations({
		description:
			"Where `citedArtifactId` came from: `explicit-id` (caller passed it), `explicit-kind` (resolved from caller's `citedArtifactKind`), `transition-derived` (resolved from the transition's required-evidence rule), or `none` (no artifact needed).",
	}),
}).annotations({ identifier: "PhaseTransitionAccepted" });

const PhaseTransitionDenied = Schema.Struct({
	accepted: Schema.Literal(false).annotations({
		description: "Discriminant — `false` when the transition was refused.",
	}),
	phase: phaseLiteral.annotations({ description: "Phase the session remains in (the current phase, unchanged)." }),
	denialReason: denialReasonLiteral.annotations({
		description: "Categorical refusal reason; see `remediation` for the suggested fix.",
	}),
	remediation: RemediationSchema,
}).annotations({ identifier: "PhaseTransitionDenied" });

export const PhaseTransitionResult = Schema.Union(PhaseTransitionAccepted, PhaseTransitionDenied).annotations({
	identifier: "PhaseTransitionResult",
	title: "tdd_phase_transition_request result",
	description:
		"Discriminate on `accepted`. Acceptance carries the new phaseId; denial carries a typed reason and a remediation pointer.",
});

export const tddPhaseTransitionRequest = publicProcedure
	.input(
		Schema.standardSchemaV1(
			Schema.Struct({
				tddTaskId: Schema.Number,
				goalId: Schema.Number,
				requestedPhase: phaseLiteral,
				// `citedArtifactId` is optional in 2.0+. When omitted, the
				// tool resolves the most recent matching artifact for this
				// session, where "matching" is either:
				//   - the explicit `citedArtifactKind` value, or
				//   - the kind required by the transition (per
				//     `requiredArtifactForTransition`), or
				//   - "no artifact needed" for transitions like `spike→red`
				//     where the validator's `requiredArtifactForTransition`
				//     returns null.
				//
				// The accepted response carries `citedArtifactId` so the
				// caller can see which row was used.
				citedArtifactId: Schema.optional(Schema.Number),
				citedArtifactKind: Schema.optional(artifactKindLiteral),
				behaviorId: Schema.optional(Schema.Number),
				reason: Schema.optional(Schema.String),
			}),
		),
	)
	.mutation(async ({ ctx, input }) => {
		return ctx.runtime.runPromise(
			Effect.gen(function* () {
				const reader = yield* DataReader;
				const store = yield* DataStore;

				// 1. Resolve current phase. If none, treat current_phase as "spike"
				//    (the entry point for every TDD cycle per D11).
				const currentOpt = yield* reader.getCurrentTddPhase(input.tddTaskId);
				const currentPhase: Phase = Option.isSome(currentOpt) ? currentOpt.value.phase : "spike";
				const phaseStartedAt = Option.isSome(currentOpt) ? currentOpt.value.startedAt : new Date().toISOString();

				// 2. Validate goal: exists + belongs to the requested TDD session + status is in_progress.
				const goalOpt = yield* reader.getGoalById(input.goalId);
				if (Option.isNone(goalOpt)) {
					return {
						accepted: false as const,
						phase: currentPhase,
						denialReason: "goal_not_found" as const,
						remediation: {
							suggestedTool: "tdd_goal",
							suggestedArgs: { action: "list", tddTaskId: input.tddTaskId },
							humanHint: `No tdd_session_goals row with id=${input.goalId}. Call tdd_goal({ action: "list" }) to find the correct goal id.`,
						},
					};
				}
				if (goalOpt.value.sessionId !== input.tddTaskId) {
					return {
						accepted: false as const,
						phase: currentPhase,
						denialReason: "goal_not_in_tdd_task" as const,
						remediation: {
							suggestedTool: "tdd_goal",
							suggestedArgs: { action: "list", tddTaskId: input.tddTaskId },
							humanHint:
								`Goal id=${input.goalId} belongs to TDD task ${goalOpt.value.sessionId}, ` +
								`not the requested tddTaskId=${input.tddTaskId}. ` +
								"Pass the tddTaskId of the goal's parent task, or pick a goal that belongs to the active task.",
						},
					};
				}
				if (goalOpt.value.status !== "in_progress") {
					return {
						accepted: false as const,
						phase: currentPhase,
						denialReason: "goal_not_in_progress" as const,
						remediation: {
							suggestedTool: "tdd_goal_update",
							suggestedArgs: { id: input.goalId, status: "in_progress" },
							humanHint:
								`Goal id=${input.goalId} has status '${goalOpt.value.status}'. ` +
								"Phase transitions require the goal to be in_progress. " +
								"Call tdd_goal_update({status:'in_progress'}) before requesting transitions.",
						},
					};
				}

				// 3. If behaviorId is supplied, validate it exists and belongs to goalId.
				if (input.behaviorId !== undefined) {
					const behaviorOpt = yield* reader.getBehaviorById(input.behaviorId);
					if (Option.isNone(behaviorOpt)) {
						return {
							accepted: false as const,
							phase: currentPhase,
							denialReason: "behavior_not_found" as const,
							remediation: {
								suggestedTool: "tdd_behavior_list",
								suggestedArgs: { scope: "goal", goalId: input.goalId },
								humanHint: `No tdd_session_behaviors row with id=${input.behaviorId}. Call tdd_behavior_list to find the correct behavior id.`,
							},
						};
					}
					if (behaviorOpt.value.goalId !== input.goalId) {
						return {
							accepted: false as const,
							phase: currentPhase,
							denialReason: "behavior_not_in_goal" as const,
							remediation: {
								suggestedTool: "tdd_behavior_get",
								suggestedArgs: { id: input.behaviorId },
								humanHint:
									`Behavior id=${input.behaviorId} belongs to goal ${behaviorOpt.value.goalId}, ` +
									`not the requested goalId=${input.goalId}. Pass the goalId of the behavior's parent goal.`,
							},
						};
					}
				}

				// 4. Resolve cited artifact id + binding-rule context.
				//
				//    Three input modes:
				//      a. `citedArtifactId` supplied → load + validate.
				//      b. `citedArtifactKind` supplied (or kind derivable
				//         from the transition) → look up the most recent
				//         matching artifact for this session.
				//      c. Neither supplied AND the transition does not
				//         require an artifact (e.g. spike→red) → skip
				//         artifact loading; pass a stub the validator
				//         won't read.
				const requiredKindForTransition = requiredArtifactForTransition(currentPhase, input.requestedPhase);

				let resolvedArtifactId: number | undefined;
				let resolvedKindSource: "explicit-id" | "explicit-kind" | "transition-derived" | "none" = "none";
				let kindToLookUp: ArtifactKind | undefined;

				if (input.citedArtifactId !== undefined) {
					resolvedArtifactId = input.citedArtifactId;
					resolvedKindSource = "explicit-id";
				} else if (input.citedArtifactKind !== undefined) {
					kindToLookUp = input.citedArtifactKind;
					resolvedKindSource = "explicit-kind";
				} else if (requiredKindForTransition !== null) {
					kindToLookUp = requiredKindForTransition.kind;
					resolvedKindSource = "transition-derived";
				}

				if (resolvedArtifactId === undefined && kindToLookUp !== undefined) {
					const recent = yield* reader.listTddArtifactsForTask({
						tddTaskId: input.tddTaskId,
						artifactKind: kindToLookUp,
						limit: 1,
					});
					if (recent.length === 0) {
						return {
							accepted: false as const,
							phase: currentPhase,
							denialReason: "missing_artifact_evidence" as const,
							remediation: {
								suggestedTool: "run_tests",
								suggestedArgs: {},
								humanHint:
									`No '${kindToLookUp}' artifact has been recorded for tdd_task ${input.tddTaskId}. ` +
									"Artifacts are recorded by hooks observing your tool calls (Decision D7) — " +
									"run the test (e.g. via run_tests) or make the file edit first; the post-tool-use " +
									"hook will write the matching tdd_artifacts row and the next call to this tool " +
									"will pick it up automatically.",
							},
						};
					}
					resolvedArtifactId = recent[0].id;
				}

				// Build the artifact context for the validator. When no
				// artifact is required AND the agent didn't supply one, we
				// pass a sentinel that the validator will never read (it
				// returns early when `requiredArtifactForTransition` returns
				// null). Otherwise load the row.
				let citedArtifact: import("vitest-agent-sdk").CitedArtifactRow;
				if (resolvedArtifactId !== undefined) {
					const artifactOpt = yield* reader.getTddArtifactWithContext(resolvedArtifactId);
					if (Option.isNone(artifactOpt)) {
						return {
							accepted: false as const,
							phase: currentPhase,
							denialReason: "missing_artifact_evidence" as const,
							remediation: {
								suggestedTool: "run_tests",
								suggestedArgs: {},
								humanHint:
									`Cited artifact id ${resolvedArtifactId} does not exist. ` +
									"Artifacts are recorded by hooks observing your tool calls (Decision D7), " +
									"so run the test (e.g. via the run_tests MCP tool) or make the file edit " +
									"first; the post-tool-use hook will write the matching tdd_artifacts row " +
									"and return its id, which can then be cited here.",
							},
						};
					}
					citedArtifact = artifactOpt.value;
				} else {
					// Stub artifact for transitions that don't require one
					// (e.g. spike→red). The validator returns early on these
					// transitions and never inspects the value.
					citedArtifact = {
						id: -1,
						phase_id: -1,
						artifact_kind: "test_written",
						test_case_id: null,
						test_case_created_turn_at: null,
						test_case_authored_in_session: false,
						test_run_id: null,
						test_first_failure_run_id: null,
						behavior_id: null,
					};
				}

				// 5. Validate against the binding rules.
				const result = validatePhaseTransition({
					tdd_task_id: input.tddTaskId,
					current_phase: currentPhase,
					phase_started_at: phaseStartedAt,
					now: new Date().toISOString(),
					requested_phase: input.requestedPhase,
					cited_artifact: citedArtifact,
					requested_behavior_id: input.behaviorId ?? null,
				});

				if (!result.accepted) {
					return result;
				}

				// 6. Open the new phase row (which closes the prior one).
				const out = yield* store.writeTddPhase({
					tddTaskId: input.tddTaskId,
					phase: result.phase,
					startedAt: new Date().toISOString(),
					...(input.behaviorId !== undefined && { behaviorId: input.behaviorId }),
					...(input.reason !== undefined && { transitionReason: input.reason }),
				});

				// 7. Auto-promote behavior status pending → in_progress on accepted transition.
				//    Only when behaviorId is supplied AND the behavior is currently pending.
				//    Failures here are swallowed so a partial promotion doesn't block phase
				//    advancement (the orchestrator can detect drift via tdd_behavior_get).
				if (input.behaviorId !== undefined) {
					yield* Effect.ignoreLogged(
						Effect.gen(function* () {
							const behOpt = yield* reader.getBehaviorById(input.behaviorId as number);
							if (Option.isSome(behOpt) && behOpt.value.status === "pending") {
								yield* store.updateBehavior({ id: input.behaviorId as number, status: "in_progress" });
							}
						}),
					);
				}

				return {
					accepted: true as const,
					phase: result.phase,
					newPhaseId: out.id,
					previousPhaseId: out.previousPhaseId,
					// Echo what was actually cited so the agent can see the
					// auto-resolved value (or confirm the explicit id).
					...(resolvedArtifactId !== undefined && {
						citedArtifactId: resolvedArtifactId,
						citedArtifactSource: resolvedKindSource,
					}),
				};
			}),
		);
	});
