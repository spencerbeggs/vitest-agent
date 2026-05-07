import { describe, expect, it } from "vitest";
import type { TrendRecord } from "../src/schemas/Trends.js";
import { computeTrend, getRecentDirection, hashTargets } from "../src/utils/compute-trend.js";

const cov = (lines: number, functions = lines, branches = lines, statements = lines) => ({
	lines,
	functions,
	branches,
	statements,
});

describe("computeTrend", () => {
	it("creates first entry with zero deltas", () => {
		const result = computeTrend(cov(80), undefined, undefined);
		expect(result.entries).toHaveLength(1);
		expect(result.entries[0].delta).toEqual(cov(0));
		expect(result.entries[0].direction).toBe("stable");
	});

	it("computes positive delta as improving", () => {
		const existing: TrendRecord = {
			entries: [
				{
					timestamp: "t1",
					coverage: cov(80),
					delta: cov(0),
					direction: "stable",
				},
			],
		};
		const result = computeTrend(cov(85), existing, undefined);
		expect(result.entries).toHaveLength(2);
		expect(result.entries[1].delta.lines).toBe(5);
		expect(result.entries[1].direction).toBe("improving");
	});

	it("computes negative delta as regressing", () => {
		const existing: TrendRecord = {
			entries: [
				{
					timestamp: "t1",
					coverage: cov(85),
					delta: cov(0),
					direction: "stable",
				},
			],
		};
		const result = computeTrend(cov(80), existing, undefined);
		expect(result.entries[1].direction).toBe("regressing");
	});

	it("resets history when targets change", () => {
		const targets1 = { global: { lines: 90 }, perFile: false, patterns: [] as [] };
		const targets2 = { global: { lines: 95 }, perFile: false, patterns: [] as [] };
		const existing: TrendRecord = {
			entries: [
				{
					timestamp: "t1",
					coverage: cov(80),
					delta: cov(0),
					direction: "stable",
					targetsHash: hashTargets(targets1),
				},
			],
		};
		const result = computeTrend(cov(82), existing, targets2);
		expect(result.entries).toHaveLength(1);
		expect(result.entries[0].delta).toEqual(cov(0));
	});

	it("caps at 50 entries", () => {
		const entries = Array.from({ length: 50 }, (_, i) => ({
			timestamp: `t${i}`,
			coverage: cov(70 + i * 0.5),
			delta: cov(0.5),
			direction: "improving" as const,
		}));
		const existing: TrendRecord = { entries };
		const result = computeTrend(cov(96), existing, undefined);
		expect(result.entries).toHaveLength(50);
		expect(result.entries[49].coverage.lines).toBe(96);
	});
});

describe("getRecentDirection", () => {
	it("returns stable for empty record", () => {
		const result = getRecentDirection({ entries: [] });
		expect(result.direction).toBe("stable");
		expect(result.runCount).toBe(0);
	});

	it("returns improving when majority improving", () => {
		const entries = [
			{ timestamp: "t1", coverage: cov(80), delta: cov(1), direction: "improving" as const },
			{ timestamp: "t2", coverage: cov(81), delta: cov(1), direction: "improving" as const },
			{ timestamp: "t3", coverage: cov(80.5), delta: cov(-0.5), direction: "regressing" as const },
		];
		const result = getRecentDirection({ entries });
		expect(result.direction).toBe("improving");
		expect(result.runCount).toBe(3);
	});

	it("limits to count parameter", () => {
		const entries = Array.from({ length: 10 }, (_, i) => ({
			timestamp: `t${i}`,
			coverage: cov(80),
			delta: cov(i < 5 ? -1 : 1),
			direction: (i < 5 ? "regressing" : "improving") as "improving" | "regressing",
		}));
		const result = getRecentDirection({ entries }, 5);
		expect(result.direction).toBe("improving");
		expect(result.runCount).toBe(5);
	});
});
