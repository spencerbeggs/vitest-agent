import type { CoverageTotals } from "../schemas/Coverage.js";
import type { ResolvedThresholds } from "../schemas/Thresholds.js";
import type { TrendEntry, TrendRecord } from "../schemas/Trends.js";

const STABLE_THRESHOLD = 0.1;
const MAX_ENTRIES = 50;

/**
 * Hash resolved targets to detect configuration changes.
 *
 * Note: JSON.stringify is order-sensitive, but resolveThresholds()
 * always produces keys in METRIC_KEYS iteration order, so the hash
 * is stable for the same logical configuration.
 * @public
 */
export function hashTargets(targets: ResolvedThresholds | undefined): string | undefined {
	if (!targets) return undefined;
	return JSON.stringify(targets);
}

/**
 * Compute direction from aggregate delta.
 *
 * Threshold is compared against the sum of all four metric deltas, not
 * per-metric. This means the sensitivity is higher when multiple metrics
 * move together vs. a single metric. This is intentional -- aggregate
 * movement is a better signal of overall trajectory.
 */
function computeDirection(delta: CoverageTotals): "improving" | "regressing" | "stable" {
	const sum = delta.lines + delta.functions + delta.branches + delta.statements;
	if (sum > STABLE_THRESHOLD) return "improving";
	if (sum < -STABLE_THRESHOLD) return "regressing";
	return "stable";
}

/**
 * Compute a new trend entry and return the updated trend record.
 *
 * If targets have changed (different hash), the trend history is
 * cleared and the new entry becomes the first data point.
 * @public
 */
export function computeTrend(
	current: CoverageTotals,
	existing: TrendRecord | undefined,
	targets: ResolvedThresholds | undefined,
): TrendRecord {
	const currentHash = hashTargets(targets);
	const entries = existing?.entries ?? [];

	// Check if targets changed -- reset if so
	const lastEntry = entries[entries.length - 1];
	const targetsChanged = lastEntry?.targetsHash !== currentHash;
	const baseEntries = targetsChanged ? [] : entries;

	const previous = baseEntries[baseEntries.length - 1];

	const delta: CoverageTotals = previous
		? {
				lines: current.lines - previous.coverage.lines,
				functions: current.functions - previous.coverage.functions,
				branches: current.branches - previous.coverage.branches,
				statements: current.statements - previous.coverage.statements,
			}
		: { lines: 0, functions: 0, branches: 0, statements: 0 };

	const entry: TrendEntry = {
		timestamp: new Date().toISOString(),
		coverage: { ...current },
		delta,
		direction: computeDirection(delta),
		...(currentHash ? { targetsHash: currentHash } : {}),
	};

	const newEntries = [...baseEntries, entry];

	// Sliding window: keep last MAX_ENTRIES
	if (newEntries.length > MAX_ENTRIES) {
		newEntries.splice(0, newEntries.length - MAX_ENTRIES);
	}

	return { entries: newEntries };
}

/**
 * Get the overall direction from recent entries.
 * @public
 */
export function getRecentDirection(
	record: TrendRecord,
	count: number = 5,
): { direction: "improving" | "regressing" | "stable"; runCount: number } {
	const entries = record.entries;
	if (entries.length === 0) return { direction: "stable", runCount: 0 };

	const recent = entries.slice(-count);
	let improving = 0;
	let regressing = 0;

	for (const e of recent) {
		if (e.direction === "improving") improving++;
		if (e.direction === "regressing") regressing++;
	}

	const direction = improving > regressing ? "improving" : regressing > improving ? "regressing" : "stable";
	return { direction, runCount: recent.length };
}
