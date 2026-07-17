import type { Effect } from "effect";
import { Context } from "effect";
import type { FormatterContext, RenderedOutput } from "../formatters/types.js";
import type { AgentReport } from "../schemas/AgentReport.js";
import type { OutputFormat } from "../schemas/Common.js";
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
