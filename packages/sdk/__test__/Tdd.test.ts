import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { BehaviorDetail, BehaviorRow, BehaviorStatus, GoalDetail, GoalRow, GoalStatus } from "../src/schemas/Tdd.js";

describe("GoalStatus", () => {
	it("accepts the four lifecycle states", () => {
		for (const value of ["pending", "in_progress", "done", "abandoned"]) {
			expect(Schema.decodeUnknownSync(GoalStatus)(value)).toBe(value);
		}
	});

	it("rejects unknown statuses", () => {
		expect(() => Schema.decodeUnknownSync(GoalStatus)("running")).toThrow();
	});
});

describe("BehaviorStatus", () => {
	it("accepts the four lifecycle states", () => {
		for (const value of ["pending", "in_progress", "done", "abandoned"]) {
			expect(Schema.decodeUnknownSync(BehaviorStatus)(value)).toBe(value);
		}
	});

	it("rejects unknown statuses", () => {
		expect(() => Schema.decodeUnknownSync(BehaviorStatus)("active")).toThrow();
	});
});

describe("GoalRow", () => {
	it("round-trips a valid goal", () => {
		const input = {
			id: 1,
			sessionId: 7,
			ordinal: 0,
			goal: "Handle out-of-bounds array access",
			status: "pending",
			createdAt: "2026-05-04T19:07:01.000Z",
		};
		const decoded = Schema.decodeUnknownSync(GoalRow)(input);
		expect(decoded.id).toBe(1);
		expect(decoded.sessionId).toBe(7);
		expect(decoded.ordinal).toBe(0);
		expect(decoded.goal).toBe("Handle out-of-bounds array access");
		expect(decoded.status).toBe("pending");
	});

	it("rejects an invalid status", () => {
		expect(() =>
			Schema.decodeUnknownSync(GoalRow)({
				id: 1,
				sessionId: 7,
				ordinal: 0,
				goal: "g",
				status: "running",
				createdAt: "2026-05-04T19:07:01.000Z",
			}),
		).toThrow();
	});
});

describe("BehaviorRow", () => {
	it("round-trips a behavior with all fields populated", () => {
		const input = {
			id: 12,
			goalId: 3,
			ordinal: 0,
			behavior: "throws RangeError when index >= array.length",
			suggestedTestName: "should throw RangeError when index >= array.length",
			status: "in_progress",
			createdAt: "2026-05-04T19:07:01.000Z",
		};
		const decoded = Schema.decodeUnknownSync(BehaviorRow)(input);
		expect(decoded.id).toBe(12);
		expect(decoded.goalId).toBe(3);
		expect(decoded.suggestedTestName).toBe("should throw RangeError when index >= array.length");
	});

	it("accepts null suggestedTestName", () => {
		const decoded = Schema.decodeUnknownSync(BehaviorRow)({
			id: 12,
			goalId: 3,
			ordinal: 0,
			behavior: "b",
			suggestedTestName: null,
			status: "pending",
			createdAt: "2026-05-04T19:07:01.000Z",
		});
		expect(decoded.suggestedTestName).toBeNull();
	});
});

describe("GoalDetail", () => {
	it("nests behaviors under a goal", () => {
		const decoded = Schema.decodeUnknownSync(GoalDetail)({
			id: 3,
			sessionId: 7,
			ordinal: 0,
			goal: "Handle bounds",
			status: "in_progress",
			createdAt: "2026-05-04T19:07:01.000Z",
			behaviors: [
				{
					id: 12,
					goalId: 3,
					ordinal: 0,
					behavior: "b1",
					suggestedTestName: null,
					status: "pending",
					createdAt: "2026-05-04T19:07:02.000Z",
				},
			],
		});
		expect(decoded.behaviors).toHaveLength(1);
		expect(decoded.behaviors[0]?.id).toBe(12);
	});

	it("accepts an empty behaviors array", () => {
		const decoded = Schema.decodeUnknownSync(GoalDetail)({
			id: 3,
			sessionId: 7,
			ordinal: 0,
			goal: "g",
			status: "pending",
			createdAt: "2026-05-04T19:07:01.000Z",
			behaviors: [],
		});
		expect(decoded.behaviors).toEqual([]);
	});
});

describe("BehaviorDetail", () => {
	it("includes parentGoal summary and dependencies", () => {
		const decoded = Schema.decodeUnknownSync(BehaviorDetail)({
			id: 12,
			goalId: 3,
			ordinal: 0,
			behavior: "b1",
			suggestedTestName: null,
			status: "pending",
			createdAt: "2026-05-04T19:07:02.000Z",
			parentGoal: {
				id: 3,
				goal: "Handle bounds",
				status: "in_progress",
			},
			dependencies: [
				{
					id: 11,
					goalId: 3,
					ordinal: 1,
					behavior: "previous behavior",
					suggestedTestName: null,
					status: "done",
					createdAt: "2026-05-04T19:07:00.000Z",
				},
			],
		});
		expect(decoded.parentGoal.id).toBe(3);
		expect(decoded.parentGoal.goal).toBe("Handle bounds");
		expect(decoded.dependencies).toHaveLength(1);
		expect(decoded.dependencies[0]?.status).toBe("done");
	});

	it("accepts empty dependencies", () => {
		const decoded = Schema.decodeUnknownSync(BehaviorDetail)({
			id: 12,
			goalId: 3,
			ordinal: 0,
			behavior: "b1",
			suggestedTestName: null,
			status: "pending",
			createdAt: "2026-05-04T19:07:02.000Z",
			parentGoal: { id: 3, goal: "g", status: "pending" },
			dependencies: [],
		});
		expect(decoded.dependencies).toEqual([]);
	});
});
