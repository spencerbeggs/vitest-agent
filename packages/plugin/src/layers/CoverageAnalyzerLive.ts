import type { CoverageReport, FileCoverageReport, MetricThresholds, ResolvedThresholds } from "@vitest-agent/sdk";
import { compressLines } from "@vitest-agent/sdk";
import { Effect, Layer, Option } from "effect";
import type { CoverageOptions } from "../services/CoverageAnalyzer.js";
import { CoverageAnalyzer } from "../services/CoverageAnalyzer.js";

// --- Istanbul duck-type interfaces (local, not Effect Schemas) ---

interface IstanbulSummary {
	statements: { pct: number };
	branches: { pct: number };
	functions: { pct: number };
	lines: { pct: number };
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
 * Match a file path against a glob pattern using basic matching.
 * Supports `*` (any segment chars) and `**` (any path segments).
 */
function matchGlob(filePath: string, pattern: string): boolean {
	// Convert glob to regex: ** matches any path, * matches non-slash chars
	const regexStr = pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex special chars (except * and ?)
		.replace(/\*\*/g, "\0") // placeholder for **
		.replace(/\*/g, "[^/]*") // * matches non-slash
		.replace(/\0/g, ".*") // ** matches anything
		.replace(/\?/g, "[^/]"); // ? matches single non-slash
	return new RegExp(`^${regexStr}$`).test(filePath);
}

/**
 * Resolve the effective thresholds for a file path by checking pattern
 * overrides first, falling back to global thresholds.
 */
function resolveEffectiveThresholds(filePath: string, resolved: ResolvedThresholds): MetricThresholds {
	for (const [pattern, metrics] of resolved.patterns) {
		if (matchGlob(filePath, pattern)) {
			return metrics;
		}
	}
	return resolved.global;
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

	const { includeBareZero } = options;
	const scoped = testedFiles !== undefined;

	const summary = coverageMap.getCoverageSummary();
	const totals = {
		statements: summary.statements.pct,
		branches: summary.branches.pct,
		functions: summary.functions.pct,
		lines: summary.lines.pct,
	};

	const testedFileSet = testedFiles ? new Set(testedFiles) : undefined;
	const lowCoverage: FileCoverageReport[] = [];
	const belowTarget: FileCoverageReport[] = [];

	for (const filePath of coverageMap.files()) {
		const fileCoverage = coverageMap.fileCoverageFor(filePath);
		const fileSummary = fileCoverage.toSummary();

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
		if (scoped && !testedFileSet?.has(filePath)) {
			// Out-of-scope files are never flagged, even if below threshold
			continue;
		}

		// Resolve effective thresholds for this file (pattern-specific or global)
		const effectiveThresholds = resolveEffectiveThresholds(filePath, options.thresholds);
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
			const effectiveTargets = resolveEffectiveThresholds(filePath, options.targets);
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
		lowCoverage,
		lowCoverageFiles: lowCoverage.map((f) => f.file),
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
