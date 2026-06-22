import { Data } from "effect";

/** @public */
export class GoalNotFoundError extends Data.TaggedError("GoalNotFoundError")<{
	readonly id: number;
	readonly reason: string;
}> {
	constructor(args: { readonly id: number; readonly reason: string }) {
		super(args);
		Object.defineProperty(this, "message", {
			value: `[goal not_found id=${args.id}] ${args.reason}`,
			enumerable: true,
			writable: false,
			configurable: true,
		});
	}
}

/** @public */
export class BehaviorNotFoundError extends Data.TaggedError("BehaviorNotFoundError")<{
	readonly id: number;
	readonly reason: string;
}> {
	constructor(args: { readonly id: number; readonly reason: string }) {
		super(args);
		Object.defineProperty(this, "message", {
			value: `[behavior not_found id=${args.id}] ${args.reason}`,
			enumerable: true,
			writable: false,
			configurable: true,
		});
	}
}

/** @public */
export class TddTaskNotFoundError extends Data.TaggedError("TddTaskNotFoundError")<{
	readonly id: number;
	readonly reason: string;
}> {
	constructor(args: { readonly id: number; readonly reason: string }) {
		super(args);
		Object.defineProperty(this, "message", {
			value: `[tdd_task not_found id=${args.id}] ${args.reason}`,
			enumerable: true,
			writable: false,
			configurable: true,
		});
	}
}

/** @public */
export type TddTaskEndOutcome = "succeeded" | "blocked" | "abandoned";

/** @public */
export class TddTaskAlreadyEndedError extends Data.TaggedError("TddTaskAlreadyEndedError")<{
	readonly id: number;
	readonly endedAt: string;
	readonly outcome: TddTaskEndOutcome;
}> {
	constructor(args: { readonly id: number; readonly endedAt: string; readonly outcome: TddTaskEndOutcome }) {
		super(args);
		Object.defineProperty(this, "message", {
			value: `[tdd_task ended id=${args.id}] outcome=${args.outcome} endedAt=${args.endedAt}`,
			enumerable: true,
			writable: false,
			configurable: true,
		});
	}
}

/** @public */
export type IllegalStatusTransitionEntity = "goal" | "behavior" | "task";

/** @public */
export class IllegalStatusTransitionError extends Data.TaggedError("IllegalStatusTransitionError")<{
	readonly entity: IllegalStatusTransitionEntity;
	readonly id: number;
	readonly from: string;
	readonly to: string;
	readonly reason: string;
}> {
	constructor(args: {
		readonly entity: IllegalStatusTransitionEntity;
		readonly id: number;
		readonly from: string;
		readonly to: string;
		readonly reason: string;
	}) {
		super(args);
		Object.defineProperty(this, "message", {
			value: `[${args.entity} illegal_transition id=${args.id}] ${args.from} → ${args.to}: ${args.reason}`,
			enumerable: true,
			writable: false,
			configurable: true,
		});
	}
}
