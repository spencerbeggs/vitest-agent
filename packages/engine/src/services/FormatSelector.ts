import type { Environment, Executor, OutputFormat } from "@vitest-agent/sdk";
import type { Effect } from "effect";
import { Context } from "effect";
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
