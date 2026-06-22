import type { Effect } from "effect";
import { Context } from "effect";
import type { Environment, Executor, OutputFormat } from "../schemas/Common.js";
/** @public */
export class FormatSelector extends Context.Tag("vitest-agent/FormatSelector")<
	FormatSelector,
	{
		readonly select: (
			executor: Executor,
			explicitFormat?: OutputFormat,
			environment?: Environment,
		) => Effect.Effect<OutputFormat>;
	}
>() {}
