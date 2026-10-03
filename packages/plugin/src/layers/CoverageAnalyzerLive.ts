import { relative } from "node:path";
import { GlobPattern } from "@effected/glob";
import type {
	CoverageReport,
	FileCoverageReport,
	GlobShortfall,
	MetricThresholds,
	ResolvedThresholds,
} from "@vitest-agent/sdk";
import { compressLines } from "@vitest-agent/sdk";
import { Effect, Layer, Option, Result } from "effect";
import type { CoverageOptions } from "../services/CoverageAnalyzer.js";
import { CoverageAnalyzer } from "../services/CoverageAnalyzer.js";
import { toPosixPath } from "../utils/to-posix-path.js";

// --- Istanbul duck-type interfaces (local, not Effect Schemas) ---

interface IstanbulMetric {
	pct: number;
	/** Present on real istanbul summaries; optional so pct-only duck-types still work. */
	covered?: number;
	total?: number;
}

interface IstanbulSummary {
	statements: IstanbulMetric;
	branches: IstanbulMetric;
	functions: IstanbulMetric;
	lines: IstanbulMetric;
}

interface IstanbulFileCoverage {
	toSummary(): IstanbulSummary;
	getUncoveredLines(): number[];
}

interface IstanbulCoverageMap {
	getCoverageSummary(): IstanbulSummary;
	files(): string[];
	fileCoverageFor(path: string): IstanbulFileCoverage;
}

/**
 * Check whether any metric in `stats` falls below its corresponding threshold.
 * Only metrics that are defined in `thresholds` are checked.
 */
function isBelowMetricThresholds(
	stats: { statements: number; branches: number; functions: number; lines: number },
	thresholds: MetricThresholds,
): boolean {
	if (thresholds.lines !== undefined && stats.lines < thresholds.lines) return true;
	if (thresholds.functions !== undefined && stats.functions < thresholds.functions) return true;
	if (thresholds.branches !== undefined && stats.branches < thresholds.branches) return true;
	if (thresholds.statements !== undefined && stats.statements < thresholds.statements) return true;
	return false;
}

type MetricName = "statements" | "branches" | "functions" | "lines";
const METRICS: ReadonlyArray<MetricName> = ["statements", "branches", "functions", "lines"];

/**
 * Istanbul's own percentage: `covered / total` floored to two decimals, and
 * 100 for an empty (`total === 0`) metric. Mirrors `istanbul-lib-coverage`'s
 * `percent()` so an aggregate computed here equals what Vitest compares.
 */
function istanbulPercent(covered: number, total: number): number {
	return total > 0 ? Math.floor((10000 * covered) / total) / 100 : 100;
}

/**
 * Aggregate a glob's matched files the way Vitest builds a glob coverage map:
 * sum `covered` and `total` per metric across the files' summaries, then take
 * the percentage of the sums (NOT a mean of per-file percentages). Returns
 * `undefined` when any file's summary lacks counts, since no honest aggregate
 * exists then.
 */
function aggregateSummaries(
	summaries: ReadonlyArray<IstanbulSummary>,
): { statements: number; branches: number; functions: number; lines: number } | undefined {
	const sums = {
		statements: { covered: 0, total: 0 },
		branches: { covered: 0, total: 0 },
		functions: { covered: 0, total: 0 },
		lines: { covered: 0, total: 0 },
	};
	for (const s of summaries) {
		for (const m of METRICS) {
			const { covered, total } = s[m];
			if (typeof covered !== "number" || typeof total !== "number") return undefined;
			sums[m].covered += covered;
			sums[m].total += total;
		}
	}
	return {
		statements: istanbulPercent(sums.statements.covered, sums.statements.total),
		branches: istanbulPercent(sums.branches.covered, sums.branches.total),
		functions: istanbulPercent(sums.functions.covered, sums.functions.total),
		lines: istanbulPercent(sums.lines.covered, sums.lines.total),
	};
}

/**
 * Runtime duck-type check for istanbul CoverageMap.
 */
function isIstanbulCoverageMap(value: unknown): value is IstanbulCoverageMap {
	if (value === null || typeof value !== "object") return false;
	const obj = value as Record<string, unknown>;
	return (
		typeof obj.getCoverageSummary === "function" &&
		typeof obj.files === "function" &&
		typeof obj.fileCoverageFor === "function"
	);
}

/**
 * Compiled matchers keyed by pattern source. Threshold patterns are a
 * small, fixed set per run and `processCoverageInternal` matches every
 * file against every pattern, so compile once and reuse.
 */
const globCache = new Map<string, GlobPattern | null>();

/**
 * Match a file path against a coverage-threshold glob with the same
 * semantics Vitest applies to `coverage.thresholds` keys (picomatch under
 * default options): `**` spans zero or more directories, `*` and `?`
 * never cross a slash, brace groups expand, character classes and
 * extglobs work, and dotfiles are not matched by wildcards (issue #381).
 * `@effected/glob` is minimatch-based and agrees with picomatch on every
 * shape a threshold key realistically takes. A pattern that fails to
 * compile (guard trip on an absurd input) matches nothing.
 */
function matchGlob(filePath: string, pattern: string): boolean {
	let compiled = globCache.get(pattern);
	if (compiled === undefined) {
		const result = GlobPattern.compileResult(pattern);
		compiled = Result.isSuccess(result) ? result.success : null;
		globCache.set(pattern, compiled);
	}
	return compiled?.matches(filePath) ?? false;
}

/**
 * Resolve the effective thresholds for a file path by checking pattern
 * overrides first, falling back to global thresholds.
 */
function resolveEffectiveThresholds(filePath: string, resolved: ResolvedThresholds): MetricThresholds {
	// v4 behavior change: `patterns` carries a Schema decoding default (`[]`),
	// which does NOT apply on the constructor/passthrough path. A
	// ResolvedThresholds handed in as a plain literal (or `.make()`) without
	// `patterns` therefore arrives `undefined` rather than `[]`, so default it
	// here before iterating.
	for (const [pattern, metrics] of resolved.patterns ?? []) {
		if (matchGlob(filePath, pattern)) {
			return metrics;
		}
	}
	return resolved.global;
}

/**
 * Resolve the per-file threshold override for a file path.
 *
 * Vitest 5 widened `perFile` to `boolean | MetricThresholds` and stopped
 * letting a glob-pattern entry inherit the top-level setting. A matched
 * pattern's own `perFile` is the ONLY per-file setting for that file — a
 * pattern that declares none does not fall back to the top-level one. The
 * top-level `perFile` applies only to files no pattern matches, mirroring
 * Vitest 5.
 *
 * Only an OBJECT-valued setting changes anything here — it replaces the
 * metric numbers used for the per-file check. `true` / `false` / absent
 * all return `null`, which leaves the existing per-file reporting behavior
 * (check against the effective metric thresholds) exactly as it was.
 */
function resolveEffectivePerFileThresholds(filePath: string, resolved: ResolvedThresholds): MetricThresholds | null {
	let setting: boolean | MetricThresholds | undefined;
	let matched = false;
	for (const [pattern, metrics] of resolved.patterns ?? []) {
		if (matchGlob(filePath, pattern)) {
			matched = true;
			setting = (metrics as { perFile?: boolean | MetricThresholds }).perFile;
			break;
		}
	}
	if (!matched) {
		setting = resolved.perFile;
	}
	if (setting === undefined || typeof setting === "boolean") return null;
	return setting;
}

/**
 * Find the threshold globs whose aggregate coverage is below their own metric
 * numbers (issue #391), matching Vitest 5: a glob's coverage map holds every
 * file in the run that matches it (a file may belong to several globs), the
 * aggregate is `sum(covered) / sum(total)` per metric, and it is enforced in
 * addition to any object `perFile`. A glob with `perFile: true` is checked per
 * file only, so it has no aggregate to fail.
 *
 * Choices (document before changing):
 * - Bare-zero files COUNT toward the aggregate, regardless of
 *   `includeBareZero`. That option only decides whether such files are listed
 *   per file; Vitest's aggregate includes them, and dropping them would hide
 *   exactly the shortfall they cause.
 * - Scoped runs never produce shortfalls (the caller skips this): a partial
 *   coverage map says nothing about a glob's full aggregate, mirroring how
 *   scoped runs never flag threshold violations.
 * - Only non-negative numbers are compared (minimum percentages). Vitest's
 *   negative "max uncovered count" form is not evaluated here.
 * - A glob that matches no file, or whose matched summaries lack
 *   covered/total counts, yields nothing.
 */
function computeGlobShortfalls(
	files: ReadonlyArray<{ matchPath: string; summary: IstanbulSummary }>,
	resolved: ResolvedThresholds,
): GlobShortfall[] {
	const shortfalls: GlobShortfall[] = [];
	for (const [pattern, metrics] of resolved.patterns ?? []) {
		if (metrics.perFile === true) continue;
		const thresholds: MetricThresholds = {
			...(metrics.lines !== undefined ? { lines: metrics.lines } : {}),
			...(metrics.functions !== undefined ? { functions: metrics.functions } : {}),
			...(metrics.branches !== undefined ? { branches: metrics.branches } : {}),
			...(metrics.statements !== undefined ? { statements: metrics.statements } : {}),
		};
		if (METRICS.every((m) => thresholds[m] === undefined)) continue;
		const matched = files.filter((f) => matchGlob(f.matchPath, pattern));
		if (matched.length === 0) continue;
		const aggregate = aggregateSummaries(matched.map((f) => f.summary));
		if (aggregate === undefined) continue;
		const short = METRICS.some((m) => {
			const min = thresholds[m];
			return min !== undefined && min >= 0 && aggregate[m] < min;
		});
		if (short) shortfalls.push({ pattern, summary: aggregate, thresholds });
	}
	return shortfalls;
}

/**
 * Internal coverage processing logic. Shared by both `process` and `processScoped`.
 *
 * @param coverageMap - The value received by `onCoverage`; duck-typed at runtime
 * @param options - Coverage processing options
 * @param testedFiles - When provided, only flag threshold violations for files in this set
 * @returns Structured coverage report, or undefined if duck-typing fails
 */
function processCoverageInternal(
	coverageMap: unknown,
	options: CoverageOptions,
	testedFiles?: ReadonlyArray<string>,
): CoverageReport | undefined {
	if (!isIstanbulCoverageMap(coverageMap)) return undefined;

	// An empty coverage map means no coverage data was collected (e.g.
	// `vitest run --passWithNoTests` with no test files). Istanbul reports
	// pct as the string "Unknown" for every metric in that case, which would
	// leak non-numeric totals into the baseline/trend writes (issue #130).
	if (coverageMap.files().length === 0) return undefined;

	const { includeBareZero } = options;
	const scoped = testedFiles !== undefined;

	const summary = coverageMap.getCoverageSummary();
	const totals = {
		statements: summary.statements.pct,
		branches: summary.branches.pct,
		functions: summary.functions.pct,
		lines: summary.lines.pct,
	};

	// Both sides of the membership test are posix-normalized: `moduleId`
	// is always forward-slash (Vitest `slash()`es test file paths at glob
	// time) while the v8 provider keys the coverage map with native
	// separators, so on Windows `C:/repo/src/a.ts` must still find
	// `C:\repo\src\a.ts`. Neither side alone is authoritative.
	const testedFileSet = testedFiles ? new Set(testedFiles.map(toPosixPath)) : undefined;
	const lowCoverage: FileCoverageReport[] = [];
	const belowTarget: FileCoverageReport[] = [];

	// Coverage providers key the map by absolute path; glob patterns are
	// root-relative (see `CoverageOptions.root`). Globs match on the
	// relative, posix-separated form; the report uses the original key.
	const { root } = options;
	const matchKey = (filePath: string): string => toPosixPath(root === undefined ? filePath : relative(root, filePath));

	// Every file's summary, collected BEFORE the bare-zero / scoped skips below:
	// a glob aggregate is evaluated over all files the glob matches, exactly as
	// Vitest builds its per-glob coverage map.
	const mapSummaries: Array<{ matchPath: string; summary: IstanbulSummary }> = [];

	for (const filePath of coverageMap.files()) {
		const matchPath = matchKey(filePath);
		const fileCoverage = coverageMap.fileCoverageFor(filePath);
		const fileSummary = fileCoverage.toSummary();
		mapSummaries.push({ matchPath, summary: fileSummary });

		const fileStats = {
			statements: fileSummary.statements.pct,
			branches: fileSummary.branches.pct,
			functions: fileSummary.functions.pct,
			lines: fileSummary.lines.pct,
		};

		const isBareZero =
			fileStats.statements === 0 && fileStats.branches === 0 && fileStats.functions === 0 && fileStats.lines === 0;

		// Skip bare-zero files unless includeBareZero is enabled
		if (isBareZero && !includeBareZero) continue;

		// For scoped processing, only flag threshold violations for in-scope files
		if (scoped && !testedFileSet?.has(toPosixPath(filePath))) {
			// Out-of-scope files are never flagged, even if below threshold
			continue;
		}

		// Resolve effective thresholds for this file (pattern-specific or global),
		// letting an object-valued `perFile` (Vitest 5) override the metric set
		// used for the per-file check.
		const effectiveThresholds =
			resolveEffectivePerFileThresholds(matchPath, options.thresholds) ??
			resolveEffectiveThresholds(matchPath, options.thresholds);
		const isBelowThreshold = isBelowMetricThresholds(fileStats, effectiveThresholds);

		if (isBareZero || isBelowThreshold) {
			const uncoveredLines = compressLines(fileCoverage.getUncoveredLines());
			lowCoverage.push({
				file: filePath,
				summary: fileStats,
				uncoveredLines,
			});
			continue;
		}

		// Check if the file is above threshold but below target
		if (options.targets) {
			// Same precedence as the thresholds path: a glob target's object
			// `perFile` replaces its metric numbers for the per-file check (#390).
			const effectiveTargets =
				resolveEffectivePerFileThresholds(matchPath, options.targets) ??
				resolveEffectiveThresholds(matchPath, options.targets);
			const isBelowTargetMetrics = isBelowMetricThresholds(fileStats, effectiveTargets);
			if (isBelowTargetMetrics) {
				const uncoveredLines = compressLines(fileCoverage.getUncoveredLines());
				belowTarget.push({
					file: filePath,
					summary: fileStats,
					uncoveredLines,
				});
			}
		}
	}

	const globShortfalls = scoped ? [] : computeGlobShortfalls(mapSummaries, options.thresholds);

	// Sort worst-first by lines percentage ascending
	lowCoverage.sort((a, b) => a.summary.lines - b.summary.lines);
	belowTarget.sort((a, b) => a.summary.lines - b.summary.lines);

	return {
		totals,
		thresholds: {
			global: options.thresholds.global,
			patterns: options.thresholds.patterns,
		},
		...(options.targets
			? {
					targets: {
						global: options.targets.global,
						patterns: options.targets.patterns,
					},
				}
			: {}),
		...(options.baselines
			? {
					baselines: {
						global: options.baselines.global,
						patterns: options.baselines.patterns,
					},
				}
			: {}),
		scoped,
		...(scoped && testedFiles ? { scopedFiles: [...testedFiles] } : {}),
		...(scoped && options.totalFiles !== undefined ? { totalFiles: options.totalFiles } : {}),
		lowCoverage,
		lowCoverageFiles: lowCoverage.map((f) => f.file),
		...(globShortfalls.length > 0 ? { globShortfalls } : {}),
		...(options.targets
			? {
					belowTarget,
					belowTargetFiles: belowTarget.map((f) => f.file),
				}
			: {}),
	};
}

/**
 * Live implementation of the CoverageAnalyzer service backed by istanbul.
 * @public
 */
export const CoverageAnalyzerLive: Layer.Layer<CoverageAnalyzer> = Layer.succeed(CoverageAnalyzer, {
	process: (coverage, options) =>
		Effect.sync(() => {
			const result = processCoverageInternal(coverage, options);
			return result ? Option.some(result) : Option.none();
		}),
	processScoped: (coverage, options, testedFiles) =>
		Effect.sync(() => {
			const result = processCoverageInternal(coverage, options, testedFiles);
			return result ? Option.some(result) : Option.none();
		}),
});
