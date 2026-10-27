/**
 * The `ok: false` envelope the goal / behavior CRUD tools return for the five
 * tagged TDD errors, on `@effected/mcp`'s `ToolOutcome`: each error is a
 * `ToolOutcome.error` schema (`_tag`, `message`, `remediation`, plus the
 * error's own fields), the tools' success schemas are `ToolOutcome.envelope`,
 * and each handler maps the errors its store call can raise with
 * `ToolOutcome.catchAsEnvelope` inline, so the agent reads a normal tool
 * response it can branch on instead of a transport error.
 */

import type { Remediation } from "@effected/engine";
import { ToolOutcome } from "@effected/mcp";
import type {
	BehaviorNotFoundError,
	GoalNotFoundError,
	IllegalStatusTransitionError,
	TddTaskAlreadyEndedError,
	TddTaskNotFoundError,
} from "@vitest-agent/sdk";
import { Schema } from "effect";

/**
 * Suggested recovery action attached to a TDD error envelope:
 * `@effected/engine`'s `Remediation` (`hint`, plus the `suggestedTool` to call
 * next and its `suggestedArgs`), the one remediation shape this package
 * serves.
 *
 * @public
 */
export type { Remediation };

/**
 * Success-shaped envelope returned by TDD CRUD tools when a known TDD error occurs.
 *
 * Instead of letting the five tagged TDD errors propagate as transport errors,
 * the goal / behavior handlers map them to this shape so the agent receives a
 * normal tool response with `ok: false`, a one-sentence `message`, and a
 * `Remediation` describing the next step.
 *
 * @public
 */
export interface TddErrorEnvelope {
	readonly ok: false;
	readonly error: {
		readonly _tag: string;
		readonly message: string;
		readonly remediation: Remediation;
		readonly [key: string]: unknown;
	};
}

const TddTaskEndOutcome = Schema.Literals(["succeeded", "blocked", "abandoned"]);
const StatusEntity = Schema.Literals(["goal", "behavior", "task"]);

/**
 * The five envelope errors, in the order they are served. Each is a named
 * `$defs` entry in the served `outputSchema`, open to extra keys as the
 * envelope always was.
 */
const TddEnvelopeErrors = [
	ToolOutcome.error("GoalNotFoundError", { id: Schema.Number, reason: Schema.String }).annotate({
		identifier: "GoalNotFoundError",
		description: "No goal with this id. `remediation` names the tool that lists goals.",
	}),
	ToolOutcome.error("BehaviorNotFoundError", { id: Schema.Number, reason: Schema.String }).annotate({
		identifier: "BehaviorNotFoundError",
		description: "No behavior with this id. `remediation` names the tool that lists behaviors.",
	}),
	ToolOutcome.error("TddTaskNotFoundError", { id: Schema.Number, reason: Schema.String }).annotate({
		identifier: "TddTaskNotFoundError",
		description: "No TDD task with this id. `remediation` names the tool that opens one.",
	}),
	ToolOutcome.error("TddTaskAlreadyEndedError", {
		id: Schema.Number,
		endedAt: Schema.String,
		outcome: TddTaskEndOutcome,
	}).annotate({
		identifier: "TddTaskAlreadyEndedError",
		description: "The TDD task has already ended, so nothing more can be added to it.",
	}),
	ToolOutcome.error("IllegalStatusTransitionError", {
		entity: StatusEntity,
		id: Schema.Number,
		from: Schema.String,
		to: Schema.String,
		reason: Schema.String,
	}).annotate({
		identifier: "IllegalStatusTransitionError",
		description: "The requested status change is not allowed; `remediation` suggests abandoning instead.",
	}),
] as const;

/**
 * A goal / behavior tool's success schema: its success members, or the
 * `{ ok: false, error }` envelope carrying one of the five TDD errors.
 *
 * @internal
 */
export const tddEnvelope = <S extends Schema.Top>(success: S) =>
	ToolOutcome.envelope(success, TddEnvelopeErrors, {
		identifier: "TddErrorEnvelope",
		description: "Returned instead of a result when a known TDD error is caught: `ok` is `false` and `error` names it.",
	});

/** @internal */
export const goalNotFound = (e: GoalNotFoundError) => ({
	id: e.id,
	reason: e.reason,
	message: `No goal with id ${e.id}.`,
	remediation: {
		suggestedTool: "tdd_goal",
		suggestedArgs: { action: "list" },
		hint: `No tdd_session_goals row with id=${e.id}. Call tdd_goal({ action: "list", tddTaskId }) to find the correct goal id.`,
	},
});

/** @internal */
export const behaviorNotFound = (e: BehaviorNotFoundError) => ({
	id: e.id,
	reason: e.reason,
	message: `No behavior with id ${e.id}.`,
	remediation: {
		suggestedTool: "tdd_behavior",
		suggestedArgs: { action: "list_by_goal" },
		hint: `No tdd_session_behaviors row with id=${e.id}. Call tdd_behavior({ action: "list_by_goal", goalId }) or tdd_behavior({ action: "list_by_tdd_task", tddTaskId }) to find the correct behavior id.`,
	},
});

/** @internal */
export const tddTaskNotFound = (e: TddTaskNotFoundError) => ({
	id: e.id,
	reason: e.reason,
	message: `No TDD task with id ${e.id}.`,
	remediation: {
		suggestedTool: "tdd_task",
		suggestedArgs: { action: "start" },
		hint: `No tdd_tasks row with id=${e.id}. Call tdd_task({ action: "start" }) to open a TDD task before creating goals or behaviors.`,
	},
});

/** @internal */
export const tddTaskAlreadyEnded = (e: TddTaskAlreadyEndedError) => ({
	id: e.id,
	endedAt: e.endedAt,
	outcome: e.outcome,
	message: `TDD task ${e.id} has already ended (${e.outcome}).`,
	remediation: {
		suggestedTool: "tdd_task",
		suggestedArgs: { action: "start" },
		hint: `tdd_tasks row id=${e.id} is already ended (outcome=${e.outcome}). Open a new TDD task if you need to add more goals or behaviors.`,
	},
});

/** @internal */
export const illegalStatusTransition = (e: IllegalStatusTransitionError) => ({
	entity: e.entity,
	id: e.id,
	from: e.from,
	to: e.to,
	reason: e.reason,
	message: `Cannot move ${e.entity} ${e.id} from ${e.from} to ${e.to}.`,
	remediation: {
		suggestedTool: e.entity === "goal" ? "tdd_goal" : "tdd_behavior",
		suggestedArgs: { action: "update", id: e.id, status: "abandoned" },
		hint: `Cannot transition ${e.entity} id=${e.id} from ${e.from} to ${e.to}. Use status:'abandoned' to drop work; do not delete unless the entity was created by mistake.`,
	},
});
