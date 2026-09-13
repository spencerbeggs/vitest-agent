import type { Environment, Executor } from "@vitest-agent/sdk";
import type { Effect } from "effect";
import { Context } from "effect";
/** @public */
export class ExecutorResolver extends Context.Service<
	ExecutorResolver,
	{
		readonly resolve: (env: Environment) => Effect.Effect<Executor>;
	}
>()("vitest-agent/ExecutorResolver") {}
