/**
 * Pure validator for the shape of a coverageTargets value.
 *
 * Returns structured errors, warnings, and info arrays. Unlike the
 * CoverageTargets Effect Schema (which rejects outright on parse), this
 * helper walks the raw input and emits pinpointed diagnostic entries so
 * the rule layer can surface them with human-readable messages.
 *
 * @packageDocumentation
 */

export interface CoverageTargetsShapeError {
	readonly code: string;
	readonly path: string;
	readonly message: string;
}

export interface CoverageTargetsShapeWarning {
	readonly code: string;
	readonly path: string;
	readonly message: string;
}

export interface CoverageTargetsShapeInfo {
	readonly code: string;
	readonly message: string;
}

export interface CoverageTargetsShapeResult {
	readonly errors: ReadonlyArray<CoverageTargetsShapeError>;
	readonly warnings: ReadonlyArray<CoverageTargetsShapeWarning>;
	readonly info: ReadonlyArray<CoverageTargetsShapeInfo>;
}

/** Metric keys that may appear at the top level or inside a glob-pattern entry. */
const METRIC_KEYS = new Set(["lines", "functions", "branches", "statements", "100"]);

/** Pushes an INVALID_TARGET_VALUE error when the numeric value is zero or negative. */
function checkNumericValue(value: number, path: string, errors: CoverageTargetsShapeError[]): void {
	if (value <= 0) {
		errors.push({
			code: "INVALID_TARGET_VALUE",
			path,
			message: `Coverage target at "${path}" must be a positive number greater than zero, got ${value}.`,
		});
	}
}

/** Emits an INVALID_TARGET_VALUE error when `true` appears at a key other than `"100"`. */
function checkBooleanShortcut(key: string, path: string, errors: CoverageTargetsShapeError[]): void {
	if (key === "100") return;
	errors.push({
		code: "INVALID_TARGET_VALUE",
		path,
		message: `Coverage target at "${path}" cannot be true. The "true" shorthand is only valid at key "100" (meaning 100% across all metrics).`,
	});
}

/** Checks all values inside a nested per-metric object (glob-pattern entry). */
function checkNestedMetrics(
	nested: Record<string, unknown>,
	prefix: string,
	errors: CoverageTargetsShapeError[],
): void {
	for (const [metricKey, metricValue] of Object.entries(nested)) {
		const path = `${prefix}.${metricKey}`;
		if (typeof metricValue === "number") {
			checkNumericValue(metricValue, path, errors);
		} else if (metricValue === true) {
			checkBooleanShortcut(metricKey, path, errors);
		}
	}
}

/**
 * Validates the shape of a raw coverageTargets value, producing structured
 * diagnostic entries. This is a pure function with no Effect or I/O.
 *
 * Codes emitted:
 * - `INVALID_TARGET_VALUE` — a numeric metric value is zero or negative,
 *   OR a literal `true` appears at any key other than `"100"`. The
 *   offending `path` is included (e.g. `"lines"`, `"src/**.ts.lines"`,
 *   or `"statements"` when misused as a boolean shortcut).
 * - `PERFILE_ON_TARGETS` — the `perFile` key appears inside coverageTargets;
 *   it should be set on `coverage.thresholds.perFile` instead.
 *
 * @param input - The raw value passed as coverageTargets.
 * @returns A result object with errors, warnings, and info arrays.
 */
export function validateCoverageTargetsShape(input: unknown): CoverageTargetsShapeResult {
	const errors: CoverageTargetsShapeError[] = [];
	const warnings: CoverageTargetsShapeWarning[] = [];
	const info: CoverageTargetsShapeInfo[] = [];

	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		return { errors, warnings, info };
	}

	for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
		if (key === "perFile") {
			warnings.push({
				code: "PERFILE_ON_TARGETS",
				path: key,
				message: 'The "perFile" key is not valid inside coverageTargets. Set coverage.thresholds.perFile instead.',
			});
			continue;
		}

		if (METRIC_KEYS.has(key)) {
			// Top-level metric key (lines, functions, branches, statements, 100).
			if (typeof value === "number") {
				checkNumericValue(value, key, errors);
			} else if (value === true) {
				checkBooleanShortcut(key, key, errors);
			}
		} else if (typeof value === "number") {
			// Glob-pattern key with a bare numeric value.
			checkNumericValue(value, key, errors);
		} else if (value === true) {
			// Glob-pattern key with a bare `true` value — same shorthand abuse as above.
			checkBooleanShortcut(key, key, errors);
		} else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
			// Glob-pattern key with a per-metric object value.
			checkNestedMetrics(value as Record<string, unknown>, key, errors);
		}
	}

	return { errors, warnings, info };
}
