import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
	BehaviorScopedEventTypes,
	BehaviorsReadyEvent,
	ChannelEvent,
	GoalCompletedEvent,
	GoalsReadyEvent,
	PhaseTransitionEvent,
	SessionCompleteEvent,
} from "../src/schemas/ChannelEvent.js";

describe("ChannelEvent", () => {
	it("decodes a goals_ready payload", () => {
		const payload = {
			type: "goals_ready" as const,
			sessionId: 7,
			goals: [
				{ id: 1, ordinal: 0, goal: "Handle bounds" },
				{ id: 2, ordinal: 1, goal: "Handle negative indices" },
			],
		};
		const result = Schema.decodeUnknownSync(ChannelEvent)(payload);
		expect(result.type).toBe("goals_ready");
	});

	it("decodes a behaviors_ready payload with goalId", () => {
		const result = Schema.decodeUnknownSync(BehaviorsReadyEvent)({
			type: "behaviors_ready",
			sessionId: 7,
			goalId: 3,
			behaviors: [{ id: 12, ordinal: 0, behavior: "throws RangeError" }],
		});
		expect(result.goalId).toBe(3);
		expect(result.behaviors).toHaveLength(1);
	});

	it("decodes a phase_transition payload with sessionId, goalId, behaviorId", () => {
		const result = Schema.decodeUnknownSync(PhaseTransitionEvent)({
			type: "phase_transition",
			sessionId: 7,
			goalId: 3,
			behaviorId: 12,
			from: "red",
			to: "green",
		});
		expect(result.from).toBe("red");
		expect(result.to).toBe("green");
	});

	it("rejects phase_transition with an unknown phase literal", () => {
		expect(() =>
			Schema.decodeUnknownSync(PhaseTransitionEvent)({
				type: "phase_transition",
				sessionId: 7,
				goalId: 3,
				behaviorId: 12,
				from: "red",
				to: "purple",
			}),
		).toThrow();
	});

	it("decodes goal_completed with behaviorIds reconciliation array", () => {
		const result = Schema.decodeUnknownSync(GoalCompletedEvent)({
			type: "goal_completed",
			sessionId: 7,
			goalId: 3,
			behaviorIds: [12, 13],
		});
		expect(result.behaviorIds).toEqual([12, 13]);
	});

	it("decodes session_complete with goalIds reconciliation array", () => {
		const result = Schema.decodeUnknownSync(SessionCompleteEvent)({
			type: "session_complete",
			sessionId: 7,
			goalIds: [3, 4],
			outcome: "succeeded",
		});
		expect(result.outcome).toBe("succeeded");
		expect(result.goalIds).toEqual([3, 4]);
	});

	it("rejects an unknown event type at the union level", () => {
		expect(() =>
			Schema.decodeUnknownSync(ChannelEvent)({
				type: "unknown_event",
				sessionId: 7,
			}),
		).toThrow();
	});

	it("rejects goals_ready missing required goals[]", () => {
		expect(() =>
			Schema.decodeUnknownSync(GoalsReadyEvent)({
				type: "goals_ready",
				sessionId: 7,
			}),
		).toThrow();
	});

	it("BehaviorScopedEventTypes lists the events whose goalId/sessionId the server resolves", () => {
		expect(BehaviorScopedEventTypes).toEqual([
			"behavior_started",
			"phase_transition",
			"behavior_completed",
			"behavior_abandoned",
			"blocked",
		]);
	});
});
