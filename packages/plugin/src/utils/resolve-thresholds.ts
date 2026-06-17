/**
 * Parse Vitest coverage.thresholds format into ResolvedThresholds.
 *
 * @packageDocumentation
 */

import type { ResolvedThresholds } from "@vitest-agent/sdk";

const METRIC_KEYS = new Set(["lines", "functions", "branches", "statements"]);
const RESERVED_KEYS = new Set([...METRIC_KEYS, "100", "perFile", "autoUpdate"]);

/**
 * Vitest thresholds input -- loose record type matching vitest config.
 */
export type VitestThresholdsInput = Record<string, unknown>;

export function resolveThresholds(input: VitestThresholdsInput | undefined): ResolvedThresholds {
	if (!input) {
		return { global: {}, perFile: false, patterns: [] };
	}

	const global: { lines?: number; functions?: number; branches?: number; statements?: number } = {};
	const patterns: Array<[string, { lines?: number; functions?: number; branches?: number; statements?: number }]> = [];
	let perFile = false;

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

	// Extract perFile
	if (input.perFile === true) {
		perFile = true;
	}

	// Extract glob patterns (any key not in reserved set with object value)
	for (const [key, value] of Object.entries(input)) {
		if (RESERVED_KEYS.has(key)) continue;
		if (typeof value !== "object" || value === null) continue;

		const patternMetrics: { lines?: number; functions?: number; branches?: number; statements?: number } = {};
		const obj = value as Record<string, unknown>;

		// Handle pattern-level 100 shorthand
		if (obj["100"] === true) {
			patternMetrics.lines = 100;
			patternMetrics.functions = 100;
			patternMetrics.branches = 100;
			patternMetrics.statements = 100;
		}

		for (const mk of METRIC_KEYS) {
			const mv = obj[mk];
			if (typeof mv === "number") {
				(patternMetrics as Record<string, number>)[mk] = mv;
			}
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
