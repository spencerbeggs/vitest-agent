import type { AgentReport } from "../schemas/AgentReport.js";
import type { DetailLevel } from "../schemas/Common.js";

/** @public */
export interface RenderedOutput {
	readonly target: "stdout" | "file" | "github-summary";
	readonly content: string;
	readonly contentType: string;
}

/** @public */
export interface FormatterContext {
	readonly detail: DetailLevel;
	readonly noColor: boolean;
	readonly coverageConsoleLimit: number;
	readonly trendSummary?: {
		direction: "improving" | "regressing" | "stable";
		runCount: number;
		firstMetric?: {
			name: string;
			from: number;
			to: number;
			target?: number;
		};
	};
	readonly runCommand?: string;
	readonly githubSummaryFile?: string;
	readonly mcp?: boolean;
}

/** @public */
export interface Formatter {
	readonly format: string;
	readonly render: (reports: ReadonlyArray<AgentReport>, context: FormatterContext) => ReadonlyArray<RenderedOutput>;
}
