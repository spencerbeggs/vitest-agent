import { Schema } from "effect";
/** @public */
export const GoalStatus = Schema.Literals(["pending", "in_progress", "done", "abandoned"]).annotate({
	identifier: "GoalStatus",
});
/** @public */
export type GoalStatus = typeof GoalStatus.Type;
/** @public */
export const BehaviorStatus = Schema.Literals(["pending", "in_progress", "done", "abandoned"]).annotate({
	identifier: "BehaviorStatus",
});
/** @public */
export type BehaviorStatus = typeof BehaviorStatus.Type;
/** @public */
export const GoalRow = Schema.Struct({
	id: Schema.Number,
	sessionId: Schema.Number,
	ordinal: Schema.Number,
	goal: Schema.String,
	status: GoalStatus,
	createdAt: Schema.String,
}).annotate({ identifier: "GoalRow" });
/** @public */
export type GoalRow = typeof GoalRow.Type;
/** @public */
export const BehaviorRow = Schema.Struct({
	id: Schema.Number,
	goalId: Schema.Number,
	ordinal: Schema.Number,
	behavior: Schema.String,
	suggestedTestName: Schema.NullOr(Schema.String),
	status: BehaviorStatus,
	createdAt: Schema.String,
}).annotate({ identifier: "BehaviorRow" });
/** @public */
export type BehaviorRow = typeof BehaviorRow.Type;
/** @public */
export const GoalDetail = Schema.Struct({
	...GoalRow.fields,
	behaviors: Schema.Array(BehaviorRow),
}).annotate({ identifier: "GoalDetail" });
/** @public */
export type GoalDetail = typeof GoalDetail.Type;
/** @public */
export const BehaviorDetail = Schema.Struct({
	...BehaviorRow.fields,
	parentGoal: Schema.Struct({
		id: Schema.Number,
		goal: Schema.String,
		status: GoalStatus,
	}),
	dependencies: Schema.Array(BehaviorRow),
}).annotate({ identifier: "BehaviorDetail" });
/** @public */
export type BehaviorDetail = typeof BehaviorDetail.Type;
