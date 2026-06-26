import type { CoverageBaselines, CoverageReport, ResolvedThresholds } from "@vitest-agent/sdk";
import type { Effect, Option } from "effect";
import { Context } from "effect";

/**
 * Options passed to `CoverageAnalyzer.process` and `CoverageAnalyzer.processScoped`.
 *
 * @public
 */
export interface CoverageOptions {
	/** Resolved coverage thresholds to check the report against. */
	readonly thresholds: ResolvedThresholds;
	/** Per-file or global coverage targets for policy enforcement. */
	readonly targets?: ResolvedThresholds;
	/** Persisted baselines used to compute coverage trends. */
	readonly baselines?: CoverageBaselines;
	/** When true, include files with zero coverage rather than omitting them. */
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
