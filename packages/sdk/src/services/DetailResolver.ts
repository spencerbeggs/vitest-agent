import type { Effect } from "effect";
import { Context } from "effect";
import type { DetailLevel, Executor } from "../schemas/Common.js";
/** @public */
export interface RunHealth {
	readonly hasFailures: boolean;
	readonly belowTargets: boolean;
	readonly hasTargets?: boolean;
}
/** @public */
export class DetailResolver extends Context.Service<
	DetailResolver,
	{
		readonly resolve: (executor: Executor, health: RunHealth, explicit?: DetailLevel) => Effect.Effect<DetailLevel>;
	}
>()("vitest-agent/DetailResolver") {}
