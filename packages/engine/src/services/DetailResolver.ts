import type { DetailLevel, Executor } from "@vitest-agent/sdk";
import type { Effect } from "effect";
import { Context } from "effect";
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
