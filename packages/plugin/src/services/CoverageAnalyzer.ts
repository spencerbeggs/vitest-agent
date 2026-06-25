import type { CoverageBaselines, CoverageReport, ResolvedThresholds } from "@vitest-agent/sdk";
import type { Effect, Option } from "effect";
import { Context } from "effect";

export interface CoverageOptions {
	readonly thresholds: ResolvedThresholds;
	readonly targets?: ResolvedThresholds;
	readonly baselines?: CoverageBaselines;
	readonly includeBareZero: boolean;
}

/**
 * Effect service for processing istanbul coverage maps into structured reports.
 * @public
 */
export class CoverageAnalyzer extends Context.Tag("vitest-agent/CoverageAnalyzer")<
	CoverageAnalyzer,
	{
		readonly process: (coverage: unknown, options: CoverageOptions) => Effect.Effect<Option.Option<CoverageReport>>;
		readonly processScoped: (
			coverage: unknown,
			options: CoverageOptions,
			testedFiles: ReadonlyArray<string>,
		) => Effect.Effect<Option.Option<CoverageReport>>;
	}
>() {}
