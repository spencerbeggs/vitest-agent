/** @public */
export type Phase =
	| "spike"
	| "red"
	| "red.triangulate"
	| "green"
	| "green.fake-it"
	| "refactor"
	| "extended-red"
	| "green-without-red";
/** @public */
export type ArtifactKind =
	| "test_written"
	| "test_failed_run"
	| "code_written"
	| "test_passed_run"
	| "refactor"
	| "test_weakened";
/**
 * Explicit test-runner marker on a `tdd_artifacts` row (issue #363). `vitest`
 * artifacts always carry a `test_case_id` when they anchor a specific test;
 * `bats` artifacts never do (there is no `test_cases` row for a bats test),
 * so the D2 binding-rule validator branches on this to accept a bats
 * run-level artifact without weakening the vitest guard.
 * @public
 */
export type ArtifactSuite = "vitest" | "bats";
/** @public */
export interface CitedArtifact {
	readonly id: number;
	/**
	 * `tdd_phases.id` of the phase this artifact was actually recorded in — the
	 * artifact's own phase binding. This is the honest anchor for D2 binding
	 * rule 1's window check (issue #245): a test_case's first-ever creation
	 * turn can predate the current phase (e.g. authored during spike, then
	 * re-run inside red) without the evidence itself being stale, so the
	 * window check compares this against `PhaseTransitionContext.current_phase_id`
	 * rather than `test_case_created_turn_at`.
	 */
	readonly phase_id: number;
	readonly artifact_kind: ArtifactKind;
	readonly test_case_id: number | null;
	readonly test_case_created_turn_at: string | null;
	readonly test_case_authored_in_session: boolean;
	readonly test_run_id: number | null;
	readonly test_first_failure_run_id: number | null;
	readonly behavior_id: number | null;
	/** Issue #363: explicit suite marker distinguishing vitest from bats runs. */
	readonly suite: ArtifactSuite;
}
/** @public */
export interface PhaseTransitionContext {
	readonly tdd_task_id: number;
	readonly current_phase: Phase;
	/**
	 * `tdd_phases.id` of the currently open phase row, or `null` when no phase
	 * has been opened yet (the implicit "spike" default before the first
	 * `tdd_phases` row exists). Compared against `cited_artifact.phase_id` for
	 * D2 binding rule 1 (issue #245).
	 */
	readonly current_phase_id: number | null;
	readonly phase_started_at: string;
	readonly now: string;
	readonly requested_phase: Phase;
	readonly cited_artifact: CitedArtifact;
	readonly requested_behavior_id: number | null;
}
/** @public */
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
/** @public */
export interface Remediation {
	readonly suggestedTool: string;
	readonly suggestedArgs: Record<string, unknown>;
	readonly humanHint: string;
}
/** @public */
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
 * @public
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
	if (from === "red.triangulate" && to === "green") {
		// Triangulation (issue #115): a batch of behaviors is satisfied by one
		// shared implementation. Later behaviors in the batch never produce their
		// own failing run (the shared code already passes them), so red.triangulate→green
		// accepts the batch's failing run as evidence — but a real failing run must
		// still exist. Returning test_failed_run here (rather than null) both engages
		// auto-resolution and closes the zero-evidence hole. The validator relaxes the
		// phase-window and behavior-match binding rules for this transition below.
		return {
			kind: "test_failed_run",
			humanHint:
				"A triangulation batch must still have produced at least one real failing run; record the batch's test_failed_run before requesting red.triangulate→green.",
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
/**
 * Whether D2 binding rule 2 (behavior-match) applies to a given transition.
 *
 * Only the transitions whose cited evidence must belong to the behavior being
 * transitioned enforce behavior-match: `red→green` (the failing test for this
 * behavior) and `green→refactor` (its passing test). It deliberately excludes
 * `red.triangulate→green` (the cited failing run belongs to an earlier batch
 * behavior) and `refactor→red` (the required `test_passed_run` is the
 * just-finished behavior's, never the new target). Exported so the MCP
 * `tdd_phase_transition_request` tool scopes artifact auto-resolution by
 * behavior on exactly the same transitions the validator will accept —
 * keeping the two in lockstep (issue #115).
 * @public
 */
export const transitionEnforcesBehaviorMatch = (from: Phase, to: Phase): boolean =>
	(from === "red" && to === "green") || (from === "green" && to === "refactor");

/** @public */
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

	// Guard (issue #361): refactor may only be entered from green or green.fake-it. A
	// plain red→refactor (or red.triangulate→refactor, spike→refactor) request skips the
	// green phase entirely — the tdd_phases table would never contain a phase="green" row,
	// so the "green" checkpoint (the test actually passing, per the tdd skill's commit-cycle
	// primitive) never happened. Auto-resolution would otherwise happily cite a stale
	// test_passed_run left over from an earlier behavior's cycle and let the transition
	// through with zero evidence that THIS behavior's implementation passes. The orchestrator
	// must enter green first via <phase>→green with a test_failed_run artifact, then request
	// green→refactor with a test_passed_run.
	if (ctx.requested_phase === "refactor" && ctx.current_phase !== "green" && ctx.current_phase !== "green.fake-it") {
		// The remediation must be actionable in one step. Only a red-family
		// source can go straight to green; from spike (or any other source)
		// the green guard above would deny the suggested hop, so point at
		// red first and spell out the full path.
		const canEnterGreen = ctx.current_phase === "red" || ctx.current_phase === "red.triangulate";
		return {
			accepted: false,
			phase: ctx.current_phase,
			denialReason: "refactor_without_passing_run",
			remediation: {
				suggestedTool: "tdd_phase_transition_request",
				suggestedArgs: { requestedPhase: canEnterGreen ? "green" : "red" },
				humanHint: canEnterGreen
					? `Cannot transition from '${ctx.current_phase}' directly to 'refactor'. The green phase must be entered first (${ctx.current_phase}→green with a test_failed_run artifact), then green→refactor requested with a test_passed_run artifact.`
					: `Cannot transition from '${ctx.current_phase}' directly to 'refactor'. Enter red first (${ctx.current_phase}→red), write and run a failing test, request red→green with a test_failed_run artifact, then green→refactor with a test_passed_run artifact.`,
			},
		};
	}

	// Triangulation (issue #115): red.triangulate→green accepts the batch's real failing
	// run as evidence for a later batch member whose own test never failed. The kind,
	// specific-test (test_case_id), session, and not-pre-existing (rule 3) guarantees still
	// apply; only the per-behavior phase-window and behavior-match rules are relaxed, because
	// the cited run legitimately belongs to an earlier behavior in the batch.
	const isTriangulateGreen = ctx.current_phase === "red.triangulate" && ctx.requested_phase === "green";

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
	// Issue #363: a bats run-level artifact (test_case_id null) carries no
	// test_case to anchor rule 1's window/authoring checks — there is no
	// test_cases row for a bats test. Rather than deny it outright (which
	// would leave every bats-only TDD cycle unable to ever pass red→green
	// or green→refactor), fall through to the artifact's OWN phase-window
	// check below (issue #245's rule, extended to cover this branch) and
	// skip the authored-in-session check. A vitest run-level artifact still
	// carries no anchor at all and is denied exactly as before.
	const isBatsRunLevel = ctx.cited_artifact.test_case_id === null && ctx.cited_artifact.suite === "bats";

	if (ctx.cited_artifact.test_case_id === null && !isBatsRunLevel) {
		return {
			accepted: false,
			phase: ctx.current_phase,
			denialReason: "missing_artifact_evidence",
			remediation: {
				suggestedTool: "run_tests",
				suggestedArgs: {},
				humanHint:
					"The cited artifact is run-level (test_case_id is null) and its suite is 'vitest', so it cannot be bound to this phase — only bats-suite run-level artifacts are accepted without a specific test. Run a specific failing test via run_tests so the resulting artifact carries a test_case_id, then cite that artifact.",
			},
		};
	}

	// The authoring-window check only applies to test_failed_run artifacts
	// (red→green). For test_passed_run artifacts (green→refactor, refactor→red),
	// the test was intentionally written in a prior phase — applying the window
	// check would incorrectly deny every green→refactor transition where the test
	// was written in the red phase (which is the normal TDD pattern).
	//
	// (issue #245) The window check keys off the cited artifact's OWN phase
	// binding (cited_artifact.phase_id vs current_phase_id) rather than the
	// test_case's first-ever creation turn. A test_case can be first created in
	// an earlier phase (e.g. authored during spike, then re-run inside red) —
	// that alone doesn't make the evidence stale, as long as the cited
	// test_failed_run artifact was itself recorded in the current phase. What
	// IS stale is an artifact recorded in a different (earlier, already-closed)
	// phase of the same task being replayed against a later phase.
	//
	// A bats run-level artifact (isBatsRunLevel) still gets the phase-window
	// check (issue #363) — it just skips the authored-in-session check below,
	// since there is no test_case to check authorship against.
	if (expected.kind === "test_failed_run" || (isBatsRunLevel && expected.kind === "test_passed_run")) {
		if (!isTriangulateGreen && ctx.current_phase_id !== null && ctx.cited_artifact.phase_id !== ctx.current_phase_id) {
			return {
				accepted: false,
				phase: ctx.current_phase,
				denialReason: "evidence_not_in_phase_window",
				remediation: {
					suggestedTool: "run_tests",
					suggestedArgs: {},
					humanHint:
						"The cited artifact was recorded in a different phase than the one currently open. Run the failing test again inside the current phase so a fresh test_failed_run artifact is bound to it.",
				},
			};
		}
		// Skipped for a bats run-level artifact (issue #363): there is no
		// test_case row for a bats test, so there is nothing to check
		// authorship against — the phase-window check above is this
		// branch's whole binding guarantee.
		if (!isBatsRunLevel && !ctx.cited_artifact.test_case_authored_in_session) {
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

	// D2 binding rule 2: behavior match (if the orchestrator requests transitioning a specific behavior).
	// Scoped (issue #115) to the transitions whose evidence must belong to the behavior being
	// transitioned — red→green (the failing test for this behavior) and green→refactor (its passing
	// test). It does NOT apply to:
	//   - red.triangulate→green: the cited failing run legitimately belongs to an earlier batch behavior;
	//   - refactor→red: the required test_passed_run is the just-finished behavior's, never the new one,
	//     so enforcing behavior-match here is a category error that forced a two-step rebind dance.
	if (
		transitionEnforcesBehaviorMatch(ctx.current_phase, ctx.requested_phase) &&
		ctx.requested_behavior_id !== null &&
		ctx.cited_artifact.behavior_id !== ctx.requested_behavior_id
	) {
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
