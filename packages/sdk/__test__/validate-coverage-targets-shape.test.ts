/**
 * Tests for validateCoverageTargetsShape and the CoverageTargets schema.
 *
 * Covers §5.2 of the 2.0-coverage-policy spec.
 * Seven test cases for the helper; four schema decode cases.
 */
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { CoverageTargets } from "../src/schemas/Options.js";
import { validateCoverageTargetsShape } from "../src/utils/validate-coverage-targets-shape.js";

const decode = Schema.decodeUnknownSync(CoverageTargets);

// ---------------------------------------------------------------------------
// CoverageTargets schema tests (§5.2 cases 1–4, schema half)
// ---------------------------------------------------------------------------

describe("CoverageTargets schema", () => {
	it("should accept per-metric positive numbers via CoverageTargets schema decode", () => {
		// Given: a valid per-metric target object
		const input = { lines: 80, functions: 75 };

		// When: decoded with the CoverageTargets schema
		const result = decode(input);

		// Then: no parse error is thrown and the result matches the input
		expect(result).toEqual(input);
	});

	it("should accept the 100:true shorthand at the top level", () => {
		// Given: the canonical Vitest shorthand using key "100" with value true
		const input = { 100: true } as const;

		// When: decoded
		const result = decode(input);

		// Then: accepted without error
		expect(result).toEqual(input);
	});

	it("should reject true at a non-100 metric key with a ParseError", () => {
		// Given: the misuse case — `true` at a key other than "100"
		const input = { statements: true };

		// When/Then: the refinement rejects because the shorthand is only valid at key "100"
		expect(() => decode(input)).toThrow();
	});

	it("should accept glob-pattern keys with nested metric objects", () => {
		// Given: a glob-pattern entry with per-metric values
		const input = { "src/critical/**.ts": { lines: 95, branches: 90 } };

		// When: decoded
		const result = decode(input);

		// Then: accepted without error
		expect(result).toEqual(input);
	});

	it("should reject negative numeric values with a ParseError", () => {
		// Given: a target object with a negative number
		const input = { lines: -10 };

		// When/Then: decoding throws because Schema.Positive rejects negatives
		expect(() => decode(input)).toThrow();
	});
});

// ---------------------------------------------------------------------------
// validateCoverageTargetsShape helper tests (§5.2 full set)
// ---------------------------------------------------------------------------

describe("validateCoverageTargetsShape", () => {
	it("should return no errors for per-metric positive numbers", () => {
		// Given
		const input = { lines: 80, functions: 75 };

		// When
		const result = validateCoverageTargetsShape(input);

		// Then
		expect(result.errors).toHaveLength(0);
		expect(result.warnings).toHaveLength(0);
	});

	it("should return no errors for the 100:true shorthand at the top level", () => {
		// Given: the canonical Vitest shorthand
		const input = { 100: true } as const;

		// When
		const result = validateCoverageTargetsShape(input);

		// Then: shorthand is recognized without diagnostics
		expect(result.errors).toHaveLength(0);
		expect(result.warnings).toHaveLength(0);
	});

	it("should return INVALID_TARGET_VALUE error when true appears at a non-100 metric key", () => {
		// Given: the misuse case — `true` at "statements" rather than "100"
		const input = { statements: true };

		// When
		const result = validateCoverageTargetsShape(input);

		// Then: the helper flags it so its diagnostics match the schema and runtime parsers
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]?.code).toBe("INVALID_TARGET_VALUE");
		expect(result.errors[0]?.path).toBe("statements");
	});

	it("should return INVALID_TARGET_VALUE error when true appears inside a glob entry at a non-100 key", () => {
		// Given: same misuse but nested under a glob pattern
		const input = { "src/**.ts": { lines: true } };

		// When
		const result = validateCoverageTargetsShape(input);

		// Then
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]?.code).toBe("INVALID_TARGET_VALUE");
		expect(result.errors[0]?.path).toBe("src/**.ts.lines");
	});

	it("should return no errors for glob-pattern entries with metric objects", () => {
		// Given
		const input = { "src/critical/**.ts": { lines: 95, branches: 90 } };

		// When
		const result = validateCoverageTargetsShape(input);

		// Then
		expect(result.errors).toHaveLength(0);
		expect(result.warnings).toHaveLength(0);
	});

	it("should return INVALID_TARGET_VALUE error for negative top-level value with path", () => {
		// Given
		const input = { lines: -10 };

		// When
		const result = validateCoverageTargetsShape(input);

		// Then
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]?.code).toBe("INVALID_TARGET_VALUE");
		expect(result.errors[0]?.path).toBe("lines");
	});

	it("should return INVALID_TARGET_VALUE error for negative value inside glob entry with full path", () => {
		// Given
		const input = { "src/**.ts": { lines: -1 } };

		// When
		const result = validateCoverageTargetsShape(input);

		// Then
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]?.code).toBe("INVALID_TARGET_VALUE");
		expect(result.errors[0]?.path).toBe("src/**.ts.lines");
	});

	it("should return INVALID_TARGET_VALUE error for zero top-level value with path", () => {
		// Given
		const input = { functions: 0 };

		// When
		const result = validateCoverageTargetsShape(input);

		// Then
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]?.code).toBe("INVALID_TARGET_VALUE");
		expect(result.errors[0]?.path).toBe("functions");
	});

	it("should return PERFILE_ON_TARGETS warning when perFile key is present", () => {
		// Given: perFile key mixed into coverageTargets
		const input = { perFile: true, lines: 80 };

		// When
		const result = validateCoverageTargetsShape(input);

		// Then: lines is valid (no errors), perFile produces a warning
		expect(result.errors).toHaveLength(0);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]?.code).toBe("PERFILE_ON_TARGETS");
	});
});
