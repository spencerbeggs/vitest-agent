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
	 * compared against the map key with only separators normalized, so
	 * callers pass the same shape the provider uses (absolute paths in
	 * production; forward or back slashes both work).
	 */
	readonly root?: string;
	/**
	 * Vitest's resolved `coverage.include` globs. When set, a coverage-map
	 * key matching none of them is dropped before any per-file or glob
	 * evaluation (issue #622). Matched like threshold patterns: against
	 * `relative(root, key)` when `root` is set, verbatim otherwise. Absent,
	 * every key is kept. A path under a `node_modules` segment is dropped
	 * regardless of this option.
	 */
	readonly include?: ReadonlyArray<string>;
	/**
	 * Vitest's resolved `coverage.exclude` globs. A coverage-map key matching
	 * any of them is dropped before evaluation (issue #622), with the same
	 * matching rule as `include`.
	 */
	readonly exclude?: ReadonlyArray<string>;
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
