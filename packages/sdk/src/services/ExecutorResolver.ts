import type { Effect } from "effect";
import { Context } from "effect";
import type { Environment, Executor } from "../schemas/Common.js";
/** @public */
export class ExecutorResolver extends Context.Tag("vitest-agent/ExecutorResolver")<
	ExecutorResolver,
	{
		readonly resolve: (env: Environment) => Effect.Effect<Executor>;
	}
>() {}
