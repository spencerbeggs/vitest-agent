/**
 * Shared error-to-success-shape envelope conversion for goal / behavior CRUD
 * tools. Maps each tagged TDD error to an ok:false response matching the
 * tdd_phase_transition_request accept/deny envelope shape, so the agent
 * sees a normal tool response instead of a transport error.
 *
 * `Effect.catchTags` returns `Effect.succeed(envelope)` so the success
 * channel carries the union `Success | ErrorEnvelope`.
 */

import { Effect } from "effect";
import {
	BehaviorNotFoundError,
	GoalNotFoundError,
	IllegalStatusTransitionError,
	TddTaskAlreadyEndedError,
	TddTaskNotFoundError,
} from "vitest-agent-sdk";

export interface Remediation {
	readonly suggestedTool: string;
	readonly suggestedArgs: Record<string, unknown>;
	readonly humanHint: string;
}

export interface TddErrorEnvelope {
	readonly ok: false;
	readonly error: {
		readonly _tag: string;
		readonly remediation: Remediation;
		readonly [key: string]: unknown;
	};
}

const goalNotFound = (e: GoalNotFoundError): TddErrorEnvelope => ({
	ok: false,
	error: {
		_tag: e._tag,
		id: e.id,
		reason: e.reason,
		remediation: {
			suggestedTool: "tdd_goal",
			suggestedArgs: { action: "list" },
			humanHint: `No tdd_session_goals row with id=${e.id}. Call tdd_goal({ action: "list", tddTaskId }) to find the correct goal id.`,
		},
	},
});

const behaviorNotFound = (e: BehaviorNotFoundError): TddErrorEnvelope => ({
	ok: false,
	error: {
		_tag: e._tag,
		id: e.id,
		reason: e.reason,
		remediation: {
			suggestedTool: "tdd_behavior",
			suggestedArgs: { action: "list_by_goal" },
			humanHint: `No tdd_session_behaviors row with id=${e.id}. Call tdd_behavior({ action: "list_by_goal", goalId }) or tdd_behavior({ action: "list_by_tdd_task", tddTaskId }) to find the correct behavior id.`,
		},
	},
});

const tddTaskNotFound = (e: TddTaskNotFoundError): TddErrorEnvelope => ({
	ok: false,
	error: {
		_tag: e._tag,
		id: e.id,
		reason: e.reason,
		remediation: {
			suggestedTool: "tdd_task",
			suggestedArgs: { action: "start" },
			humanHint: `No tdd_tasks row with id=${e.id}. Call tdd_task({ action: "start" }) to open a TDD task before creating goals or behaviors.`,
		},
	},
});

const tddTaskAlreadyEnded = (e: TddTaskAlreadyEndedError): TddErrorEnvelope => ({
	ok: false,
	error: {
		_tag: e._tag,
		id: e.id,
		endedAt: e.endedAt,
		outcome: e.outcome,
		remediation: {
			suggestedTool: "tdd_task",
			suggestedArgs: { action: "start" },
			humanHint: `tdd_tasks row id=${e.id} is already ended (outcome=${e.outcome}). Open a new TDD task if you need to add more goals or behaviors.`,
		},
	},
});

const illegalStatusTransition = (e: IllegalStatusTransitionError): TddErrorEnvelope => ({
	ok: false,
	error: {
		_tag: e._tag,
		entity: e.entity,
		id: e.id,
		from: e.from,
		to: e.to,
		reason: e.reason,
		remediation: {
			suggestedTool: e.entity === "goal" ? "tdd_goal" : "tdd_behavior",
			suggestedArgs: { action: "update", id: e.id, status: "abandoned" },
			humanHint: `Cannot transition ${e.entity} id=${e.id} from ${e.from} to ${e.to}. Use status:'abandoned' to drop work; do not delete unless the entity was created by mistake.`,
		},
	},
});

type KnownTddError =
	| GoalNotFoundError
	| BehaviorNotFoundError
	| TddTaskNotFoundError
	| TddTaskAlreadyEndedError
	| IllegalStatusTransitionError;

const isKnownTddError = (e: unknown): e is KnownTddError =>
	e instanceof GoalNotFoundError ||
	e instanceof BehaviorNotFoundError ||
	e instanceof TddTaskNotFoundError ||
	e instanceof TddTaskAlreadyEndedError ||
	e instanceof IllegalStatusTransitionError;

const tddErrorToEnvelope = (e: KnownTddError): TddErrorEnvelope => {
	if (e instanceof GoalNotFoundError) return goalNotFound(e);
	if (e instanceof BehaviorNotFoundError) return behaviorNotFound(e);
	if (e instanceof TddTaskNotFoundError) return tddTaskNotFound(e);
	if (e instanceof TddTaskAlreadyEndedError) return tddTaskAlreadyEnded(e);
	return illegalStatusTransition(e);
};

export const catchTddErrorsAsEnvelope = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<A | TddErrorEnvelope, Exclude<E, KnownTddError>, R> =>
	effect.pipe(
		Effect.catchAll((e: E) =>
			isKnownTddError(e) ? Effect.succeed(tddErrorToEnvelope(e)) : Effect.fail(e as Exclude<E, KnownTddError>),
		),
	);
