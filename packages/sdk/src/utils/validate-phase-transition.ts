export type Phase =
	| "spike"
	| "red"
	| "red.triangulate"
	| "green"
	| "green.fake-it"
	| "refactor"
	| "extended-red"
	| "green-without-red";

export type ArtifactKind =
	| "test_written"
	| "test_failed_run"
	| "code_written"
	| "test_passed_run"
	| "refactor"
	| "test_weakened";

export interface CitedArtifact {
	readonly id: number;
	readonly artifact_kind: ArtifactKind;
	readonly test_case_id: number | null;
	readonly test_case_created_turn_at: string | null;
	readonly test_case_authored_in_session: boolean;
	readonly test_run_id: number | null;
	readonly test_first_failure_run_id: number | null;
	readonly behavior_id: number | null;
}

export interface PhaseTransitionContext {
	readonly tdd_task_id: number;
	readonly current_phase: Phase;
	readonly phase_started_at: string;
	readonly now: string;
	readonly requested_phase: Phase;
	readonly cited_artifact: CitedArtifact;
	readonly requested_behavior_id: number | null;
}

export type DenialReason =
	| "missing_artifact_evidence"
	| "wrong_artifact_kind"
	| "wrong_source_phase"
	| "unknown_tdd_task"
	| "tdd_task_already_ended"
	| "goal_not_started"
	| "goal_not_found"
	| "goal_not_in_progress"
	| "goal_not_in_tdd_task"
	| "behavior_not_found"
	| "behavior_not_in_goal"
	| "refactor_without_passing_run"
	| "evidence_not_in_phase_window"
	| "evidence_not_for_behavior"
	| "evidence_test_was_already_failing";

export interface Remediation {
	readonly suggestedTool: string;
	readonly suggestedArgs: Record<string, unknown>;
	readonly humanHint: string;
}

export type PhaseTransitionResult =
	| { readonly accepted: true; readonly phase: Phase }
	| {
			readonly accepted: false;
			readonly phase: Phase;
			readonly denialReason: DenialReason;
			readonly remediation: Remediation;
	  };

/**
 * Return the artifact kind a phase transition requires, plus a
 * human-readable hint for surfacing in remediations.
 *
 * Exported so the MCP `tdd_phase_transition_request` tool can pre-compute
 * the expected kind when the agent omits `citedArtifactId` (auto-resolve
 * to the most recent matching artifact). The transitions without a
 * required artifact (`spike→red`, `*→red`, etc.) return `null`.
 */
export const requiredArtifactForTransition = (
	from: Phase,
	to: Phase,
): { kind: ArtifactKind; humanHint: string } | null => {
	if (from === "red" && to === "green") {
		return {
			kind: "test_failed_run",
			humanHint:
				"Run the failing test via run_tests, then record the test_failed_run artifact before requesting red→green.",
		};
	}
	if (from === "green" && to === "refactor") {
		return {
			kind: "test_passed_run",
			humanHint:
				"Run the test via run_tests and confirm it passes; record test_passed_run before requesting green→refactor.",
		};
	}
	if (from === "refactor" && to === "red") {
		return {
			kind: "test_passed_run",
			humanHint:
				"Refactor must end with all tests still passing; record test_passed_run before starting the next behavior.",
		};
	}
	return null;
};

export const validatePhaseTransition = (ctx: PhaseTransitionContext): PhaseTransitionResult => {
	// Guard: green may only be entered from a red-family phase (red, red.triangulate)
	// or from green.fake-it (the "generalize" sub-step). Jumping from spike or refactor
	// directly to green skips the named red phase entirely — the tdd_phases table would
	// never contain a phase="red" row, breaking the phase-evidence integrity metric and
	// the D2 binding-rule model. The orchestrator must transition spike→red (or
	// refactor→red) first, then write a failing test, then request red→green.
	if (
		ctx.requested_phase === "green" &&
		ctx.current_phase !== "red" &&
		ctx.current_phase !== "red.triangulate" &&
		ctx.current_phase !== "green.fake-it"
	) {
		return {
			accepted: false,
			phase: ctx.current_phase,
			denialReason: "wrong_source_phase",
			remediation: {
				suggestedTool: "tdd_phase_transition_request",
				suggestedArgs: { requestedPhase: "red" },
				humanHint: `Cannot transition from '${ctx.current_phase}' directly to 'green'. The red phase must be entered explicitly first (${ctx.current_phase}→red), then a failing test written and run, then red→green requested with a test_failed_run artifact.`,
			},
		};
	}

	const expected = requiredArtifactForTransition(ctx.current_phase, ctx.requested_phase);
	if (expected === null) {
		// Transitions without a required artifact (e.g. spike→red, the entry
		// point for every TDD cycle) are accepted unconditionally. The three
		// evidence-bearing transitions (red→green, green→refactor, refactor→red)
		// fall through to the artifact and binding-rule checks below.
		return { accepted: true, phase: ctx.requested_phase };
	}

	if (ctx.cited_artifact.artifact_kind !== expected.kind) {
		return {
			accepted: false,
			phase: ctx.current_phase,
			denialReason: "wrong_artifact_kind",
			remediation: {
				suggestedTool: "run_tests",
				suggestedArgs: {},
				humanHint: expected.humanHint,
			},
		};
	}

	// D2 binding rule 1: cited test was created in this phase window AND authored
	// in this session. Rule 1 binds a *test* authoring window, so it requires a
	// specific test_case_id to bind to.
	//
	// Run-level artifacts (test_case_id IS NULL) — e.g. test_failed_run /
	// test_passed_run rows recorded by post-tool-use/tdd-artifact.sh on a Bash
	// test invocation that didn't resolve a specific test — carry no anchor
	// for the binding. Skipping rule 1 in that case would let *any* run-level
	// failure (including one from a different session, a different phase, or a
	// pre-existing failure on main) advance the phase machine. So instead we
	// deny: the agent must run a specific test via run_tests so the resulting
	// artifact carries a test_case_id, then cite that artifact.
	if (ctx.cited_artifact.test_case_id === null) {
		return {
			accepted: false,
			phase: ctx.current_phase,
			denialReason: "missing_artifact_evidence",
			remediation: {
				suggestedTool: "run_tests",
				suggestedArgs: {},
				humanHint:
					"The cited artifact has no specific test (test_case_id is null), so it cannot be bound to this phase. Run a specific failing test via run_tests so the resulting artifact carries a test_case_id, then cite that artifact.",
			},
		};
	}

	// The authoring-window check only applies to test_failed_run artifacts
	// (red→green). For test_passed_run artifacts (green→refactor, refactor→red),
	// the test was intentionally written in a prior phase — applying the window
	// check would incorrectly deny every green→refactor transition where the test
	// was written in the red phase (which is the normal TDD pattern).
	if (expected.kind === "test_failed_run") {
		if (
			ctx.cited_artifact.test_case_created_turn_at !== null &&
			ctx.cited_artifact.test_case_created_turn_at < ctx.phase_started_at
		) {
			return {
				accepted: false,
				phase: ctx.current_phase,
				denialReason: "evidence_not_in_phase_window",
				remediation: {
					suggestedTool: "run_tests",
					suggestedArgs: {},
					humanHint:
						"The cited test was authored before this phase started. Write a new failing test inside the current phase.",
				},
			};
		}
		if (!ctx.cited_artifact.test_case_authored_in_session) {
			return {
				accepted: false,
				phase: ctx.current_phase,
				denialReason: "evidence_not_in_phase_window",
				remediation: {
					suggestedTool: "run_tests",
					suggestedArgs: {},
					humanHint:
						"The cited test was not authored in this TDD session. Write the test yourself in the current phase.",
				},
			};
		}
	}

	// D2 binding rule 2: behavior match (if the orchestrator requests transitioning a specific behavior)
	if (ctx.requested_behavior_id !== null && ctx.cited_artifact.behavior_id !== ctx.requested_behavior_id) {
		return {
			accepted: false,
			phase: ctx.current_phase,
			denialReason: "evidence_not_for_behavior",
			remediation: {
				suggestedTool: "run_tests",
				suggestedArgs: {},
				humanHint:
					"The cited artifact references a different behavior than the one being transitioned. Run the test for the requested behavior.",
			},
		};
	}

	// D2 binding rule 3: cited test wasn't already failing on main
	if (
		expected.kind === "test_failed_run" &&
		ctx.cited_artifact.test_run_id !== null &&
		ctx.cited_artifact.test_first_failure_run_id !== null &&
		ctx.cited_artifact.test_first_failure_run_id !== ctx.cited_artifact.test_run_id
	) {
		return {
			accepted: false,
			phase: ctx.current_phase,
			denialReason: "evidence_test_was_already_failing",
			remediation: {
				suggestedTool: "run_tests",
				suggestedArgs: {},
				humanHint: "The cited test was already failing before this TDD session. Write a new test for the goal.",
			},
		};
	}

	return { accepted: true, phase: ctx.requested_phase };
};
