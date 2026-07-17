import type { Effect } from "effect";
import { Context } from "effect";
import type { Environment, Executor, OutputFormat } from "../schemas/Common.js";
/** @public */
export class FormatSelector extends Context.Service<
	FormatSelector,
	{
		readonly select: (
			executor: Executor,
			explicitFormat?: OutputFormat,
			environment?: Environment,
		) => Effect.Effect<OutputFormat>;
	}
>()("vitest-agent/FormatSelector") {}
