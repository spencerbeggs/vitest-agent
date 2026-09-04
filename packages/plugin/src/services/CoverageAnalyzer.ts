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
	/**
	 * Total test-file count for the project, when known (issue #160 gap 1).
	 * Only meaningful on a scoped run — threaded onto the returned
	 * `CoverageReport.totalFiles` so the scoped-coverage note can render
	 * "N of M test files" instead of just "N".
	 */
	readonly totalFiles?: number;
}

/**
 * Effect service for processing istanbul coverage maps into structured reports.
 * @public
 */
export class CoverageAnalyzer extends Context.Service<
	CoverageAnalyzer,
	{
		readonly process: (coverage: unknown, options: CoverageOptions) => Effect.Effect<Option.Option<CoverageReport>>;
		readonly processScoped: (
			coverage: unknown,
			options: CoverageOptions,
			testedFiles: ReadonlyArray<string>,
		) => Effect.Effect<Option.Option<CoverageReport>>;
	}
>()("vitest-agent/CoverageAnalyzer") {}
