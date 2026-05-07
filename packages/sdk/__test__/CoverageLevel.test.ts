import { describe, expect, it } from "vitest";
import { CoverageLevel, resolveCoverageInput, validateCoverageConfig } from "../src/schemas/CoverageLevel.js";

describe("CoverageLevel static presets", () => {
	it("none has all zeros", () => {
		expect(CoverageLevel.none).toMatchObject({ lines: 0, functions: 0, branches: 0, statements: 0 });
	});
	it("basic has 50 across all metrics", () => {
		expect(CoverageLevel.basic).toMatchObject({ lines: 50, functions: 50, branches: 50, statements: 50 });
	});
	it("standard has correct values", () => {
		expect(CoverageLevel.standard).toMatchObject({ lines: 70, functions: 70, branches: 65, statements: 70 });
	});
	it("strict has correct values", () => {
		expect(CoverageLevel.strict).toMatchObject({ lines: 80, functions: 80, branches: 75, statements: 80 });
	});
	it("full has correct values", () => {
		expect(CoverageLevel.full).toMatchObject({ lines: 90, functions: 90, branches: 85, statements: 90 });
	});
});

describe("CoverageLevel.withPerFile()", () => {
	it("returns a new instance with perFile: true", () => {
		const level = CoverageLevel.strict.withPerFile();
		expect(level.perFile).toBe(true);
		expect(level.lines).toBe(80);
	});
	it("does not mutate the original", () => {
		CoverageLevel.strict.withPerFile();
		expect(CoverageLevel.strict.perFile).toBeUndefined();
	});
	it("chaining withPerFile on withPerFile is idempotent", () => {
		expect(CoverageLevel.basic.withPerFile().withPerFile().perFile).toBe(true);
	});
});

describe("CoverageLevel.extend()", () => {
	it("overrides specific metrics and leaves others unchanged", () => {
		const level = CoverageLevel.standard.extend({ lines: 75 });
		expect(level.lines).toBe(75);
		expect(level.branches).toBe(65);
		expect(level.functions).toBe(70);
	});
	it("preserves perFile when extending", () => {
		const level = CoverageLevel.strict.withPerFile().extend({ lines: 85 });
		expect(level.perFile).toBe(true);
		expect(level.lines).toBe(85);
	});
	it("can override perFile via extend", () => {
		const level = CoverageLevel.strict.extend({ perFile: true });
		expect(level.perFile).toBe(true);
	});
});

describe("CoverageLevel subclassing", () => {
	class TeamLevels extends CoverageLevel {
		static readonly api = new TeamLevels({ lines: 85, functions: 80, branches: 75, statements: 85 });
	}
	it("subclass instances are instanceof CoverageLevel", () => {
		expect(TeamLevels.api).toBeInstanceOf(CoverageLevel);
	});
	it("subclass instance fields are accessible", () => {
		expect(TeamLevels.api.lines).toBe(85);
		expect(TeamLevels.api.branches).toBe(75);
	});
});

describe("resolveCoverageInput()", () => {
	it("resolves a string name to the matching preset", () => {
		const result = resolveCoverageInput("strict", "none");
		expect(result.lines).toBe(80);
		expect(result).toBeInstanceOf(CoverageLevel);
	});
	it("passes a CoverageLevel instance through unchanged", () => {
		const custom = CoverageLevel.basic.extend({ lines: 55 });
		expect(resolveCoverageInput(custom, "none")).toBe(custom);
	});
	it("returns the fallback preset when input is undefined", () => {
		expect(resolveCoverageInput(undefined, "none").lines).toBe(0);
		expect(resolveCoverageInput(undefined, "strict").lines).toBe(80);
	});
	it("throws on an unrecognised string", () => {
		expect(() => resolveCoverageInput("ultra" as never, "none")).toThrow(/Unknown coverage level/);
	});
});

describe("validateCoverageConfig()", () => {
	it("passes when all targets >= thresholds", () => {
		expect(() => validateCoverageConfig(CoverageLevel.basic, CoverageLevel.strict)).not.toThrow();
	});
	it("passes when thresholds === targets", () => {
		expect(() => validateCoverageConfig(CoverageLevel.strict, CoverageLevel.strict)).not.toThrow();
	});
	it("throws when a target metric is below the threshold", () => {
		expect(() => validateCoverageConfig(CoverageLevel.strict, CoverageLevel.basic)).toThrow(
			/coverageTargets\.lines.*50.*lower.*coverageThresholds\.lines.*80/,
		);
	});
	it("throws when thresholds has perFile:true but targets does not", () => {
		expect(() => validateCoverageConfig(CoverageLevel.strict.withPerFile(), CoverageLevel.strict)).toThrow(/perFile/);
	});
	it("throws when targets has perFile:true but thresholds does not", () => {
		expect(() => validateCoverageConfig(CoverageLevel.strict, CoverageLevel.strict.withPerFile())).toThrow(/perFile/);
	});
	it("passes when both have perFile:true and targets >= thresholds", () => {
		expect(() =>
			validateCoverageConfig(CoverageLevel.basic.withPerFile(), CoverageLevel.strict.withPerFile()),
		).not.toThrow();
	});
});
