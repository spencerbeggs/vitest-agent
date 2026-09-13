import type { AgentReport, FormatterContext, OutputFormat, RenderedOutput } from "@vitest-agent/sdk";
import type { Effect } from "effect";
import { Context } from "effect";
/** @public */
export class OutputRenderer extends Context.Service<
	OutputRenderer,
	{
		readonly render: (
			reports: ReadonlyArray<AgentReport>,
			format: OutputFormat,
			context: FormatterContext,
		) => Effect.Effect<ReadonlyArray<RenderedOutput>>;
	}
>()("vitest-agent/OutputRenderer") {}
