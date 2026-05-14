/**
 * Typed schema for the `coverageTargets` plugin option.
 *
 * @packageDocumentation
 */

import { Schema } from "effect";

/**
 * Per-metric leaf shape for coverageTargets entries. Allows optional
 * numeric targets per metric and the `100: true` shortcut.
 */
export const CoverageTargetsMetrics = Schema.Struct({
	lines: Schema.optional(Schema.Positive),
	functions: Schema.optional(Schema.Positive),
	branches: Schema.optional(Schema.Positive),
	statements: Schema.optional(Schema.Positive),
	100: Schema.optional(Schema.Literal(true)),
}).annotations({ identifier: "CoverageTargetsMetrics" });
export type CoverageTargetsMetrics = typeof CoverageTargetsMetrics.Type;

/**
 * Typed schema for the coverageTargets option.
 *
 * Mirrors Vitest's coverage.thresholds shape — per-metric positive numbers,
 * the `100: true` shortcut (only valid at key `"100"`), and glob-pattern
 * entries with metric objects. Positive numbers only; negatives and zeros
 * are rejected. `perFile` is not allowed here — inherit it from
 * `coverage.thresholds.perFile`.
 *
 * A decode-time refinement rejects `true` at any key other than `"100"`
 * so `{ statements: true }` fails parse rather than silently flowing
 * through to a runtime parser that only honors the canonical shorthand
 * at key `"100"`.
 */
export const CoverageTargets = Schema.Record({
	key: Schema.String,
	value: Schema.Union(Schema.Positive, Schema.Literal(true), CoverageTargetsMetrics),
}).pipe(
	Schema.filter((targets) => {
		for (const [key, value] of Object.entries(targets)) {
			if (value === true && key !== "100") {
				return `coverageTargets.${key} cannot be true. The "true" shorthand is only valid at key "100" (meaning 100% across all metrics).`;
			}
		}
		return undefined;
	}),
	Schema.annotations({ identifier: "CoverageTargets" }),
);
export type CoverageTargets = typeof CoverageTargets.Type;
