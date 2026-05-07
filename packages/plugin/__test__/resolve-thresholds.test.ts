import { describe, expect, it } from "vitest";
import { getMinThreshold, resolveThresholds } from "../src/utils/resolve-thresholds.js";

describe("resolveThresholds", () => {
	it("returns empty defaults for undefined input", () => {
		const result = resolveThresholds(undefined);
		expect(result.global).toEqual({});
		expect(result.perFile).toBe(false);
		expect(result.patterns).toEqual([]);
	});

	it("extracts global metrics", () => {
		const result = resolveThresholds({ lines: 80, functions: 70 });
		expect(result.global.lines).toBe(80);
		expect(result.global.functions).toBe(70);
		expect(result.global.branches).toBeUndefined();
	});

	it("handles 100 shorthand", () => {
		const result = resolveThresholds({ 100: true });
		expect(result.global).toEqual({
			lines: 100,
			functions: 100,
			branches: 100,
			statements: 100,
		});
	});

	it("explicit metrics override 100 shorthand", () => {
		const result = resolveThresholds({ 100: true, lines: 90 });
		expect(result.global.lines).toBe(90);
		expect(result.global.functions).toBe(100);
	});

	it("extracts perFile flag", () => {
		const result = resolveThresholds({ perFile: true, lines: 80 });
		expect(result.perFile).toBe(true);
	});

	it("extracts glob patterns", () => {
		const result = resolveThresholds({
			lines: 50,
			"src/utils/**.ts": { lines: 90, branches: 80 },
		});
		expect(result.patterns).toEqual([["src/utils/**.ts", { lines: 90, branches: 80 }]]);
		expect(result.global.lines).toBe(50);
	});

	it("handles pattern-level 100 shorthand", () => {
		const result = resolveThresholds({
			"src/critical/**.ts": { 100: true },
		});
		expect(result.patterns[0][1]).toEqual({
			lines: 100,
			functions: 100,
			branches: 100,
			statements: 100,
		});
	});

	it("preserves negative numbers", () => {
		const result = resolveThresholds({ lines: -10, functions: 80 });
		expect(result.global.lines).toBe(-10);
		expect(result.global.functions).toBe(80);
	});

	it("ignores autoUpdate key", () => {
		const result = resolveThresholds({ autoUpdate: true, lines: 80 });
		expect(result.global.lines).toBe(80);
		expect(result.patterns).toEqual([]);
	});

	it("ignores non-object pattern values", () => {
		const result = resolveThresholds({
			lines: 80,
			someString: "not an object",
		});
		expect(result.patterns).toEqual([]);
	});
});

describe("getMinThreshold", () => {
	it("returns minimum positive threshold", () => {
		const result = getMinThreshold({
			global: { lines: 90, functions: 70, branches: 80 },
			perFile: false,
			patterns: [],
		});
		expect(result).toBe(70);
	});

	it("ignores negative thresholds", () => {
		const result = getMinThreshold({
			global: { lines: -10, functions: 80 },
			perFile: false,
			patterns: [],
		});
		expect(result).toBe(80);
	});

	it("returns 0 for empty thresholds", () => {
		const result = getMinThreshold({
			global: {},
			perFile: false,
			patterns: [],
		});
		expect(result).toBe(0);
	});
});
