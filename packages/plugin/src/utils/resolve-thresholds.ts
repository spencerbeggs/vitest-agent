import type { MetricThresholds, PatternMetricThresholds, ResolvedThresholds } from "@vitest-agent/sdk";

const METRIC_KEYS = new Set(["lines", "functions", "branches", "statements"]);
const RESERVED_KEYS = new Set([...METRIC_KEYS, "100", "perFile", "autoUpdate"]);

/**
 * Loose record type matching Vitest's `coverage.thresholds` config input.
 * @public
 */
export type VitestThresholdsInput = Record<string, unknown>;

/**
 * Extract the four metric numbers (plus the `100: true` shorthand) from a
 * raw threshold-shaped record. Shared by the global, glob-pattern, and
 * object-valued `perFile` paths.
 */
function extractMetrics(obj: Record<string, unknown>): MetricThresholds {
	const metrics: { lines?: number; functions?: number; branches?: number; statements?: number } = {};

	if (obj["100"] === true) {
		metrics.lines = 100;
		metrics.functions = 100;
		metrics.branches = 100;
		metrics.statements = 100;
	}

	for (const mk of METRIC_KEYS) {
		const mv = obj[mk];
		if (typeof mv === "number") {
			(metrics as Record<string, number>)[mk] = mv;
		}
	}

	return metrics;
}

/**
 * Parse Vitest `coverage.thresholds` format into a normalized `ResolvedThresholds`.
 * @param input - The raw `coverage.thresholds` object from Vitest config
 * @returns Normalized thresholds with global, perFile, and pattern entries
 * @public
 */
export function resolveThresholds(input: VitestThresholdsInput | undefined): ResolvedThresholds {
	if (!input) {
		return { global: {}, perFile: false, patterns: [] };
	}

	const global: { lines?: number; functions?: number; branches?: number; statements?: number } = {};
	const patterns: Array<[string, PatternMetricThresholds]> = [];
	let perFile: boolean | MetricThresholds = false;

	// Handle 100 shorthand
	if (input["100"] === true) {
		global.lines = 100;
		global.functions = 100;
		global.branches = 100;
		global.statements = 100;
	}

	// Extract global metrics (explicit values override 100 shorthand)
	for (const key of METRIC_KEYS) {
		const value = input[key];
		if (typeof value === "number") {
			(global as Record<string, number>)[key] = value;
		}
	}

	// Extract perFile. Vitest 5 widened it to `boolean | MetricThresholds`;
	// an object narrows which metrics the per-file check enforces.
	if (input.perFile === true) {
		perFile = true;
	} else if (typeof input.perFile === "object" && input.perFile !== null && !Array.isArray(input.perFile)) {
		perFile = extractMetrics(input.perFile as Record<string, unknown>);
	}

	// Extract glob patterns (any key not in reserved set with object value)
	for (const [key, value] of Object.entries(input)) {
		if (RESERVED_KEYS.has(key)) continue;
		if (typeof value !== "object" || value === null) continue;

		const obj = value as Record<string, unknown>;
		const patternMetrics: PatternMetricThresholds = extractMetrics(obj);

		// Vitest 5: a glob entry does NOT inherit the top-level `perFile`.
		// Capture only what the entry itself declared.
		if (obj.perFile === true || obj.perFile === false) {
			(patternMetrics as { perFile?: boolean | MetricThresholds }).perFile = obj.perFile;
		} else if (typeof obj.perFile === "object" && obj.perFile !== null && !Array.isArray(obj.perFile)) {
			(patternMetrics as { perFile?: boolean | MetricThresholds }).perFile = extractMetrics(
				obj.perFile as Record<string, unknown>,
			);
		}

		if (Object.keys(patternMetrics).length > 0) {
			patterns.push([key, patternMetrics]);
		}
	}

	return { global, perFile, patterns };
}

/**
 * Extract a single minimum threshold number for backward-compatible
 * "low coverage" detection.
 */
export function getMinThreshold(thresholds: ResolvedThresholds): number {
	const values = [
		thresholds.global.lines,
		thresholds.global.functions,
		thresholds.global.branches,
		thresholds.global.statements,
	]
		// Negative values are Vitest's "allowed uncovered count" mode -- we only
		// track percentage-based thresholds here for backward-compatible display.
		.filter((v): v is number => typeof v === "number" && v >= 0);

	if (values.length === 0) return 0;
	return Math.min(...values);
}
