/**
 * CoverageLevel Effect Schema class with named presets and validation helpers.
 *
 * Provides a subclassable Schema.Class with five named presets (none, basic,
 * standard, strict, full), fluent builders (withPerFile, extend), and two
 * standalone helpers: resolveCoverageInput and validateCoverageConfig.
 *
 * @packageDocumentation
 */

import { Schema } from "effect";

/**
 * A coverage level configuration with per-metric thresholds and an optional
 * perFile flag. Extend this class to define custom named presets.
 */
export class CoverageLevel extends Schema.Class<CoverageLevel>("CoverageLevel")({
	lines: Schema.Number,
	functions: Schema.Number,
	branches: Schema.Number,
	statements: Schema.Number,
	perFile: Schema.optional(Schema.Boolean),
}) {
	/** No enforcement — all metrics at 0%. */
	static readonly none = new CoverageLevel({ lines: 0, functions: 0, branches: 0, statements: 0 });

	/** Minimal coverage bar — all metrics at 50%. */
	static readonly basic = new CoverageLevel({
		lines: 50,
		functions: 50,
		branches: 50,
		statements: 50,
	});

	/** Recommended default — lines/functions/statements at 70%, branches at 65%. */
	static readonly standard = new CoverageLevel({
		lines: 70,
		functions: 70,
		branches: 65,
		statements: 70,
	});

	/** High-quality bar — lines/functions/statements at 80%, branches at 75%. */
	static readonly strict = new CoverageLevel({
		lines: 80,
		functions: 80,
		branches: 75,
		statements: 80,
	});

	/** Near-complete coverage — lines/functions/statements at 90%, branches at 85%. */
	static readonly full = new CoverageLevel({
		lines: 90,
		functions: 90,
		branches: 85,
		statements: 90,
	});

	/**
	 * Returns a new CoverageLevel instance with perFile set to true.
	 * Does not mutate the original.
	 */
	withPerFile(): CoverageLevel {
		return new CoverageLevel({
			lines: this.lines,
			functions: this.functions,
			branches: this.branches,
			statements: this.statements,
			perFile: true,
		});
	}

	/**
	 * Returns a new CoverageLevel instance with the given fields overridden.
	 * Does not mutate the original. Existing perFile is preserved unless
	 * explicitly overridden.
	 */
	extend(
		overrides: Partial<{
			lines: number;
			functions: number;
			branches: number;
			statements: number;
			perFile: boolean;
		}>,
	): CoverageLevel {
		return new CoverageLevel({
			lines: this.lines,
			functions: this.functions,
			branches: this.branches,
			statements: this.statements,
			perFile: this.perFile,
			...overrides,
		});
	}
}

/** The named preset identifiers. */
export type CoverageLevelName = "none" | "basic" | "standard" | "strict" | "full";

/** Accepted input forms: a preset name string or a CoverageLevel instance. */
export type CoverageInput = CoverageLevelName | CoverageLevel;

const PRESET_MAP: Readonly<Record<CoverageLevelName, CoverageLevel>> = Object.freeze({
	none: CoverageLevel.none,
	basic: CoverageLevel.basic,
	standard: CoverageLevel.standard,
	strict: CoverageLevel.strict,
	full: CoverageLevel.full,
});

/**
 * Resolves a CoverageInput (preset name or CoverageLevel instance) to a
 * CoverageLevel. When input is undefined, returns the named fallback preset.
 * Throws if a string is provided that does not match a known preset name.
 */
export function resolveCoverageInput(input: CoverageInput | undefined, fallback: CoverageLevelName): CoverageLevel {
	if (input === undefined) return PRESET_MAP[fallback];
	if (input instanceof CoverageLevel) return input;
	if (input in PRESET_MAP) return PRESET_MAP[input as CoverageLevelName];
	throw new Error(
		`[vitest-agent] Unknown coverage level name: "${input}". ` +
			`Valid names are: ${Object.keys(PRESET_MAP).join(", ")}.`,
	);
}

/**
 * Validates that coverageTargets are not below coverageThresholds for any
 * metric, and that both agree on perFile. Throws a descriptive Error on
 * any violation.
 */
export function validateCoverageConfig(thresholds: CoverageLevel, targets: CoverageLevel): void {
	const metrics = ["lines", "functions", "branches", "statements"] as const;
	for (const metric of metrics) {
		if (targets[metric] < thresholds[metric]) {
			throw new Error(
				`[vitest-agent] coverageTargets.${metric} (${targets[metric]}%) is lower than ` +
					`coverageThresholds.${metric} (${thresholds[metric]}%). Targets must be ≥ thresholds.`,
			);
		}
	}
	if (thresholds.perFile === true && targets.perFile !== true) {
		throw new Error(
			`[vitest-agent] coverageThresholds sets perFile: true but coverageTargets does not. ` +
				`Both must agree on perFile.`,
		);
	}
	if (targets.perFile === true && thresholds.perFile !== true) {
		throw new Error(
			`[vitest-agent] coverageTargets sets perFile: true but coverageThresholds does not. ` +
				`Both must agree on perFile.`,
		);
	}
}
