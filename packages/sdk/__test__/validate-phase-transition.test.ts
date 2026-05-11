import { describe, expect, it } from "vitest";
import type { PhaseTransitionContext } from "../src/utils/validate-phase-transition.js";
import { validatePhaseTransition } from "../src/utils/validate-phase-transition.js";

const baseCtx = (overrides: Partial<PhaseTransitionContext> = {}): PhaseTransitionContext => ({
	tdd_task_id: 1,
	current_phase: "red",
	phase_started_at: "2026-04-29T00:00:00Z",
	now: "2026-04-29T00:01:00Z",
	requested_phase: "green",
	cited_artifact: {
		id: 100,
		artifact_kind: "test_failed_run",
		test_case_id: 50,
		test_case_created_turn_at: "2026-04-29T00:00:30Z",
		test_case_authored_in_session: true,
		test_run_id: 200,
		test_first_failure_run_id: 200,
		behavior_id: null,
	},
	requested_behavior_id: null,
	...overrides,
});

describe("validatePhaseTransition", () => {
	it("accepts a valid red→green transition", () => {
		const result = validatePhaseTransition(baseCtx());
		expect(result.accepted).toBe(true);
	});

	it("rejects red→green with wrong_artifact_kind when cited artifact is the wrong kind", () => {
		const result = validatePhaseTransition(
			baseCtx({ cited_artifact: { ...baseCtx().cited_artifact, artifact_kind: "test_written" } }),
		);
		expect(result.accepted).toBe(false);
		if (!result.accepted) {
			expect(result.denialReason).toBe("wrong_artifact_kind");
		}
	});

	it("accepts spike→red unconditionally (entry point for every TDD cycle)", () => {
		// spike→red is the entry point for every TDD cycle; it has no
		// required artifact and is always accepted.
		expect(validatePhaseTransition(baseCtx({ current_phase: "spike", requested_phase: "red" })).accepted).toBe(true);
	});

	it("should deny spike→green with wrong_source_phase and require red as intermediate phase", () => {
		// Given: the orchestrator is in spike phase and tries to jump directly to green
		// without first transitioning through red. The spike→green path skips the named
		// red phase entirely — meaning the tdd_phases table never has a row with
		// phase="red", so acceptance_metrics phase-evidence integrity is always 0%.
		const result = validatePhaseTransition(baseCtx({ current_phase: "spike", requested_phase: "green" }));

		// Then: the transition should be denied — spike must transition to red first,
		// and only then can red→green proceed with a test_failed_run artifact.
		expect(result.accepted).toBe(false);
		if (!result.accepted) {
			expect(result.denialReason).toBe("wrong_source_phase");
		}
	});

	it("should deny refactor→green with wrong_source_phase and require red as intermediate phase", () => {
		// Given: the orchestrator is in refactor phase and tries to jump directly to green
		// without transitioning through red first. This would allow a new behavior cycle
		// to start in green without any test_failed_run artifact, violating D11.
		const result = validatePhaseTransition(baseCtx({ current_phase: "refactor", requested_phase: "green" }));

		// Then: the transition should be denied — refactor must go to red first,
		// forcing the orchestrator to write a new failing test for the next behavior
		// before making any production code change.
		expect(result.accepted).toBe(false);
		if (!result.accepted) {
			expect(result.denialReason).toBe("wrong_source_phase");
		}
	});

	it("rejects red→green with missing_artifact_evidence when cited artifact has no test_case_id", () => {
		// Run-level artifacts (e.g. test_failed_run rows recorded by
		// post-tool-use/tdd-artifact.sh on a Bash invocation that didn't
		// resolve a specific test) carry no anchor to bind to. Skipping
		// rule 1 in this case would let *any* run-level failure — including
		// one from a different session or a pre-existing failure on main —
		// advance the phase machine. The validator denies; the orchestrator
		// must run a specific failing test so the artifact carries a
		// test_case_id, then cite that artifact.
		const result = validatePhaseTransition(
			baseCtx({
				cited_artifact: {
					...baseCtx().cited_artifact,
					test_case_id: null,
					test_case_created_turn_at: null,
					test_case_authored_in_session: false,
				},
			}),
		);
		expect(result.accepted).toBe(false);
		if (!result.accepted) expect(result.denialReason).toBe("missing_artifact_evidence");
	});

	it("rejects D2 binding rule 1: cited test created before phase start", () => {
		// Precondition: test_case_id is set (50, from baseCtx), so rule 1 applies.
		// The phase-window check then trips because created_turn_at predates
		// phase_started_at.
		const result = validatePhaseTransition(
			baseCtx({
				cited_artifact: {
					...baseCtx().cited_artifact,
					test_case_created_turn_at: "2026-04-28T00:00:00Z",
				},
			}),
		);
		expect(result.accepted).toBe(false);
		if (!result.accepted) expect(result.denialReason).toBe("evidence_not_in_phase_window");
	});

	it("rejects D2 binding rule 1: test not authored in this session", () => {
		// Precondition: test_case_id is set (50, from baseCtx), so rule 1 applies.
		// The session check then trips because authored_in_session is false. The
		// null-test_case_id case is handled by the "accepts run-level evidence"
		// test above — rule 1 is skipped entirely there.
		const result = validatePhaseTransition(
			baseCtx({
				cited_artifact: {
					...baseCtx().cited_artifact,
					test_case_authored_in_session: false,
				},
			}),
		);
		expect(result.accepted).toBe(false);
		if (!result.accepted) expect(result.denialReason).toBe("evidence_not_in_phase_window");
	});

	it("rejects D2 binding rule 2: requested behavior_id doesn't match artifact's", () => {
		const result = validatePhaseTransition(
			baseCtx({
				requested_behavior_id: 1,
				cited_artifact: { ...baseCtx().cited_artifact, behavior_id: 2 },
			}),
		);
		expect(result.accepted).toBe(false);
		if (!result.accepted) expect(result.denialReason).toBe("evidence_not_for_behavior");
	});

	it("rejects D2 binding rule 3: cited test was already failing on main", () => {
		const result = validatePhaseTransition(
			baseCtx({
				cited_artifact: {
					...baseCtx().cited_artifact,
					test_first_failure_run_id: 5, // earlier than test_run_id 200
				},
			}),
		);
		expect(result.accepted).toBe(false);
		if (!result.accepted) expect(result.denialReason).toBe("evidence_test_was_already_failing");
	});

	it("accepts green→refactor when test was authored in a prior phase (test_passed_run does not require authoring-window)", () => {
		// Given: a green→refactor transition where the test was written in red
		// (test_case_created_turn_at predates the green phase start)
		const result = validatePhaseTransition(
			baseCtx({
				current_phase: "green",
				requested_phase: "refactor",
				phase_started_at: "2026-04-29T00:01:00Z",
				cited_artifact: {
					id: 100,
					artifact_kind: "test_passed_run",
					test_case_id: 50,
					// authored during the red phase — before the green phase started
					test_case_created_turn_at: "2026-04-29T00:00:30Z",
					test_case_authored_in_session: true,
					test_run_id: 200,
					test_first_failure_run_id: null,
					behavior_id: null,
				},
			}),
		);

		// Then: accepted — the authoring-window check applies only to test_failed_run (red→green)
		expect(result.accepted).toBe(true);
	});

	it("rejects refactor→x when no test_passed_run in current phase", () => {
		const result = validatePhaseTransition(
			baseCtx({
				current_phase: "refactor",
				requested_phase: "red",
				cited_artifact: {
					...baseCtx().cited_artifact,
					artifact_kind: "test_failed_run",
				},
			}),
		);
		// Wrong: refactor→red transition is fine here; this asserts wrong_source_phase first
		expect(result.accepted).toBe(false);
	});

	it("should accept red→green when test_case_created_turn_at is null but test_case_id is set and authored_in_session is true", () => {
		// Given: an artifact where the test_case_id is populated (test case exists)
		// but test_case_created_turn_at is null (the backfill column was not populated —
		// this is exactly the BUG-2 scenario before migration 0004 runs). The null
		// timestamp means the window check (created_turn_at < phase_started_at) is
		// skipped via the `!== null` guard. The authored_in_session check still applies
		// and should pass when true.
		const result = validatePhaseTransition(
			baseCtx({
				cited_artifact: {
					...baseCtx().cited_artifact,
					test_case_id: 50,
					test_case_created_turn_at: null,
					test_case_authored_in_session: true,
				},
			}),
		);

		// Then: the transition should be accepted — a null turn timestamp is not evidence
		// the test was created before the phase started; the authoring-window guard only
		// fires when the timestamp is present AND predates the phase start.
		expect(result.accepted).toBe(true);
	});

	it("should accept red→green and skip D2 rule 3 when test_run_id is null", () => {
		// Given: an artifact where test_run_id is null (e.g. the test run row was not
		// yet persisted when the artifact was recorded). D2 rule 3 requires BOTH
		// test_run_id AND test_first_failure_run_id to be non-null before it fires;
		// when test_run_id is null the rule is bypassed entirely.
		const result = validatePhaseTransition(
			baseCtx({
				cited_artifact: {
					...baseCtx().cited_artifact,
					test_run_id: null,
					test_first_failure_run_id: 5,
				},
			}),
		);

		// Then: the transition should be accepted — D2 rule 3 short-circuits on null test_run_id.
		expect(result.accepted).toBe(true);
	});

	it("should accept red→green and skip D2 rule 3 when test_first_failure_run_id is null", () => {
		// Given: an artifact where test_first_failure_run_id is null (no prior failure
		// recorded for this test). D2 rule 3 requires BOTH to be non-null AND unequal.
		const result = validatePhaseTransition(
			baseCtx({
				cited_artifact: {
					...baseCtx().cited_artifact,
					test_run_id: 200,
					test_first_failure_run_id: null,
				},
			}),
		);

		// Then: accepted — the rule 3 condition is not met (first_failure_run_id is null).
		expect(result.accepted).toBe(true);
	});

	it("should accept red→green when test_run_id equals test_first_failure_run_id (test first failed in this run)", () => {
		// Given: an artifact where test_run_id === test_first_failure_run_id,
		// meaning this is the first time the test has ever been seen failing.
		// D2 rule 3 requires them to be DIFFERENT (pre-existing failure) to deny.
		const result = validatePhaseTransition(
			baseCtx({
				cited_artifact: {
					...baseCtx().cited_artifact,
					test_run_id: 200,
					test_first_failure_run_id: 200, // equal -> new failure, not pre-existing
				},
			}),
		);

		// Then: accepted — baseCtx already has this configuration; this is the
		// canonical "test was first introduced as failing in this run" case.
		expect(result.accepted).toBe(true);
	});

	it("should deny green→refactor with missing_artifact_evidence when test_passed_run artifact has no test_case_id", () => {
		// Given: a green→refactor request with a test_passed_run artifact where
		// test_case_id is null (a run-level artifact with no specific test anchor).
		// The test_case_id === null guard fires before the authoring-window check
		// and denies the transition regardless of artifact kind.
		const result = validatePhaseTransition(
			baseCtx({
				current_phase: "green",
				requested_phase: "refactor",
				cited_artifact: {
					id: 100,
					artifact_kind: "test_passed_run",
					test_case_id: null,
					test_case_created_turn_at: null,
					test_case_authored_in_session: false,
					test_run_id: 200,
					test_first_failure_run_id: null,
					behavior_id: null,
				},
			}),
		);

		// Then: denied — run-level test_passed_run artifacts (no test_case_id) are not
		// sufficient evidence for green→refactor, for the same reason they are not
		// sufficient for red→green: the validator cannot bind them to a specific test.
		expect(result.accepted).toBe(false);
		if (!result.accepted) {
			expect(result.denialReason).toBe("missing_artifact_evidence");
		}
	});

	it("should deny evidence_not_for_behavior when requested_behavior_id is set and cited artifact behavior_id is null", () => {
		// Given: the orchestrator is requesting a transition for behavior 7, but
		// the cited artifact's behavior_id is null (not associated with any behavior).
		// The behavior-match rule (D2 rule 2) fires because requested_behavior_id is
		// non-null and null !== 7.
		const result = validatePhaseTransition(
			baseCtx({
				requested_behavior_id: 7,
				cited_artifact: {
					...baseCtx().cited_artifact,
					behavior_id: null,
				},
			}),
		);

		// Then: denied with evidence_not_for_behavior — the artifact is not linked
		// to the behavior being transitioned.
		expect(result.accepted).toBe(false);
		if (!result.accepted) {
			expect(result.denialReason).toBe("evidence_not_for_behavior");
		}
	});

	it("should accept refactor→red with a valid test_passed_run artifact and return the correct accepted phase", () => {
		// Given: a refactor→red transition (the canonical end-of-refactor step)
		// with a test_passed_run artifact. This is the third evidence-bearing
		// transition; the test validates the full acceptance path including the
		// returned phase value.
		const result = validatePhaseTransition(
			baseCtx({
				current_phase: "refactor",
				requested_phase: "red",
				cited_artifact: {
					id: 100,
					artifact_kind: "test_passed_run",
					test_case_id: 50,
					test_case_created_turn_at: "2026-04-29T00:00:30Z",
					test_case_authored_in_session: true,
					test_run_id: 200,
					test_first_failure_run_id: null,
					behavior_id: null,
				},
			}),
		);

		// Then: accepted and the returned phase is the requested "red" phase.
		expect(result.accepted).toBe(true);
		if (result.accepted) {
			expect(result.phase).toBe("red");
		}
	});

	it("should return the denied phase (current_phase) not the requested phase when denying wrong_artifact_kind", () => {
		// Given: a red→green request with an artifact of the wrong kind.
		// When the transition is denied, the returned phase should be the current
		// phase (red), not the requested phase (green) — the state machine stays put.
		const result = validatePhaseTransition(
			baseCtx({
				current_phase: "red",
				requested_phase: "green",
				cited_artifact: {
					...baseCtx().cited_artifact,
					artifact_kind: "test_written",
				},
			}),
		);

		expect(result.accepted).toBe(false);
		if (!result.accepted) {
			expect(result.denialReason).toBe("wrong_artifact_kind");
			// The phase returned on denial should be the CURRENT phase, not the requested one
			expect(result.phase).toBe("red");
		}
	});
});
