import type { Effect } from "effect";
import { Context } from "effect";
import type { Environment, Executor } from "../schemas/Common.js";
/** @public */
export class ExecutorResolver extends Context.Service<
	ExecutorResolver,
	{
		readonly resolve: (env: Environment) => Effect.Effect<Executor>;
	}
>()("vitest-agent/ExecutorResolver") {}
