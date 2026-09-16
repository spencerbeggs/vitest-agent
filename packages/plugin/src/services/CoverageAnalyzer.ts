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
	/**
	 * The Vitest config root. When set, every coverage-map key is matched
	 * against threshold / target glob patterns as `relative(root, key)` —
	 * the shape Vitest's own threshold evaluator globs on. The v8 and
	 * istanbul providers key the map by ABSOLUTE path, so without this a
	 * relative pattern like `src/**\/*.ts` never matches. Absent, keys are
	 * matched verbatim. Reported `file` fields keep the map's original key.
	 *
	 * `root` does NOT apply to `processScoped`'s `testedFiles`: those are
	 * compared against the raw map key, so callers pass the same shape the
	 * provider uses (absolute paths in production).
	 */
	readonly root?: string;
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
