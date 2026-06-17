import type { CoverageReport } from "@vitest-agent/sdk";
import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";
import { CoverageAnalyzerLive } from "../src/layers/CoverageAnalyzerLive.js";
import { CoverageAnalyzerTest } from "../src/layers/CoverageAnalyzerTest.js";
import { CoverageAnalyzer } from "../src/services/CoverageAnalyzer.js";

function mockCoverageMap(
	files: Record<
		string,
		{
			summary: { statements: number; branches: number; functions: number; lines: number };
			uncoveredLines: number[];
		}
	>,
	totals = { statements: 90, branches: 85, functions: 88, lines: 91 },
): unknown {
	return {
		getCoverageSummary: () => ({
			statements: { pct: totals.statements },
			branches: { pct: totals.branches },
			functions: { pct: totals.functions },
			lines: { pct: totals.lines },
		}),
		files: () => Object.keys(files),
		fileCoverageFor: (path: string) => ({
			toSummary: () => {
				const s = files[path].summary;
				return {
					statements: { pct: s.statements },
					branches: { pct: s.branches },
					functions: { pct: s.functions },
					lines: { pct: s.lines },
				};
			},
			getUncoveredLines: () => files[path].uncoveredLines,
		}),
	};
}

const run = <A>(effect: Effect.Effect<A, never, CoverageAnalyzer>) =>
	Effect.runPromise(Effect.provide(effect, CoverageAnalyzerLive));

describe("CoverageAnalyzerLive", () => {
	it("returns correct totals", async () => {
		const map = mockCoverageMap(
			{
				"src/a.ts": {
					summary: { statements: 80, branches: 70, functions: 90, lines: 85 },
					uncoveredLines: [10, 11],
				},
			},
			{ statements: 90, branches: 85, functions: 88, lines: 91 },
		);

		const result = await run(
			Effect.flatMap(CoverageAnalyzer, (ca) =>
				ca.process(map, {
					thresholds: {
						global: { lines: 80, functions: 80, branches: 80, statements: 80 },
						perFile: false,
						patterns: [],
					},
					includeBareZero: false,
				}),
			),
		);

		expect(Option.isSome(result)).toBe(true);
		const report = Option.getOrThrow(result);
		expect(report.totals).toEqual({ statements: 90, branches: 85, functions: 88, lines: 91 });
	});

	it("flags files below threshold", async () => {
		const map = mockCoverageMap({
			"src/low.ts": {
				summary: { statements: 40, branches: 50, functions: 60, lines: 45 },
				uncoveredLines: [1, 2, 3],
			},
			"src/high.ts": {
				summary: { statements: 95, branches: 90, functions: 100, lines: 92 },
				uncoveredLines: [],
			},
		});

		const result = await run(
			Effect.flatMap(CoverageAnalyzer, (ca) =>
				ca.process(map, {
					thresholds: {
						global: { lines: 80, functions: 80, branches: 80, statements: 80 },
						perFile: false,
						patterns: [],
					},
					includeBareZero: false,
				}),
			),
		);

		const report = Option.getOrThrow(result);
		expect(report.lowCoverageFiles).toEqual(["src/low.ts"]);
		expect(report.lowCoverage).toHaveLength(1);
		expect(report.lowCoverage[0].file).toBe("src/low.ts");
	});

	it("skips bare-zero files by default", async () => {
		const map = mockCoverageMap({
			"src/bare.ts": {
				summary: { statements: 0, branches: 0, functions: 0, lines: 0 },
				uncoveredLines: [1, 2, 3, 4, 5],
			},
		});

		const result = await run(
			Effect.flatMap(CoverageAnalyzer, (ca) =>
				ca.process(map, {
					thresholds: {
						global: { lines: 80, functions: 80, branches: 80, statements: 80 },
						perFile: false,
						patterns: [],
					},
					includeBareZero: false,
				}),
			),
		);

		const report = Option.getOrThrow(result);
		expect(report.lowCoverage).toHaveLength(0);
	});

	it("BUG FIX: includeBareZero=true with threshold=0 includes bare-zero files", async () => {
		const map = mockCoverageMap({
			"src/bare.ts": {
				summary: { statements: 0, branches: 0, functions: 0, lines: 0 },
				uncoveredLines: [1, 2, 3],
			},
		});

		const result = await run(
			Effect.flatMap(CoverageAnalyzer, (ca) =>
				ca.process(map, {
					thresholds: { global: { lines: 0, functions: 0, branches: 0, statements: 0 }, perFile: false, patterns: [] },
					includeBareZero: true,
				}),
			),
		);

		const report = Option.getOrThrow(result);
		expect(report.lowCoverage).toHaveLength(1);
		expect(report.lowCoverage[0].file).toBe("src/bare.ts");
	});

	it("BUG FIX: includeBareZero=false with threshold=0 excludes bare-zero files", async () => {
		const map = mockCoverageMap({
			"src/bare.ts": {
				summary: { statements: 0, branches: 0, functions: 0, lines: 0 },
				uncoveredLines: [1, 2, 3],
			},
		});

		const result = await run(
			Effect.flatMap(CoverageAnalyzer, (ca) =>
				ca.process(map, {
					thresholds: { global: { lines: 0, functions: 0, branches: 0, statements: 0 }, perFile: false, patterns: [] },
					includeBareZero: false,
				}),
			),
		);

		const report = Option.getOrThrow(result);
		expect(report.lowCoverage).toHaveLength(0);
	});

	it("sorts worst-first by lines percentage", async () => {
		const map = mockCoverageMap({
			"src/medium.ts": {
				summary: { statements: 60, branches: 60, functions: 60, lines: 60 },
				uncoveredLines: [10],
			},
			"src/worst.ts": {
				summary: { statements: 20, branches: 20, functions: 20, lines: 20 },
				uncoveredLines: [1, 2, 3, 4, 5],
			},
			"src/bad.ts": {
				summary: { statements: 40, branches: 40, functions: 40, lines: 40 },
				uncoveredLines: [1, 2, 3],
			},
		});

		const result = await run(
			Effect.flatMap(CoverageAnalyzer, (ca) =>
				ca.process(map, {
					thresholds: {
						global: { lines: 80, functions: 80, branches: 80, statements: 80 },
						perFile: false,
						patterns: [],
					},
					includeBareZero: false,
				}),
			),
		);

		const report = Option.getOrThrow(result);
		expect(report.lowCoverageFiles).toEqual(["src/worst.ts", "src/bad.ts", "src/medium.ts"]);
	});

	it("compresses uncovered lines into range strings", async () => {
		const map = mockCoverageMap({
			"src/a.ts": {
				summary: { statements: 50, branches: 50, functions: 50, lines: 50 },
				uncoveredLines: [1, 2, 3, 5, 10, 11, 12],
			},
		});

		const result = await run(
			Effect.flatMap(CoverageAnalyzer, (ca) =>
				ca.process(map, {
					thresholds: {
						global: { lines: 80, functions: 80, branches: 80, statements: 80 },
						perFile: false,
						patterns: [],
					},
					includeBareZero: false,
				}),
			),
		);

		const report = Option.getOrThrow(result);
		expect(report.lowCoverage[0].uncoveredLines).toBe("1-3,5,10-12");
	});

	it("returns Option.none() for non-istanbul input", async () => {
		const result = await run(
			Effect.flatMap(CoverageAnalyzer, (ca) =>
				ca.process(
					{ notACoverageMap: true },
					{
						thresholds: {
							global: { lines: 80, functions: 80, branches: 80, statements: 80 },
							perFile: false,
							patterns: [],
						},
						includeBareZero: false,
					},
				),
			),
		);

		expect(Option.isNone(result)).toBe(true);
	});

	it("returns Option.none() for null", async () => {
		const result = await run(
			Effect.flatMap(CoverageAnalyzer, (ca) =>
				ca.process(null, {
					thresholds: {
						global: { lines: 80, functions: 80, branches: 80, statements: 80 },
						perFile: false,
						patterns: [],
					},
					includeBareZero: false,
				}),
			),
		);

		expect(Option.isNone(result)).toBe(true);
	});

	describe("processScoped", () => {
		it("only flags threshold violations for files in testedFiles set", async () => {
			const map = mockCoverageMap({
				"src/tested.ts": {
					summary: { statements: 40, branches: 40, functions: 40, lines: 40 },
					uncoveredLines: [1, 2, 3],
				},
				"src/untested.ts": {
					summary: { statements: 30, branches: 30, functions: 30, lines: 30 },
					uncoveredLines: [1, 2, 3, 4],
				},
			});

			const result = await run(
				Effect.flatMap(CoverageAnalyzer, (ca) =>
					ca.processScoped(
						map,
						{
							thresholds: {
								global: { lines: 80, functions: 80, branches: 80, statements: 80 },
								perFile: false,
								patterns: [],
							},
							includeBareZero: false,
						},
						["src/tested.ts"],
					),
				),
			);

			const report = Option.getOrThrow(result);
			expect(report.lowCoverageFiles).toEqual(["src/tested.ts"]);
			expect(report.lowCoverage).toHaveLength(1);
		});

		it("sets scoped=true in result", async () => {
			const map = mockCoverageMap({});

			const result = await run(
				Effect.flatMap(CoverageAnalyzer, (ca) =>
					ca.processScoped(
						map,
						{
							thresholds: {
								global: { lines: 80, functions: 80, branches: 80, statements: 80 },
								perFile: false,
								patterns: [],
							},
							includeBareZero: false,
						},
						[],
					),
				),
			);

			const report = Option.getOrThrow(result);
			expect(report.scoped).toBe(true);
		});

		it("populates scopedFiles with input files", async () => {
			const map = mockCoverageMap({});
			const testedFiles = ["src/a.ts", "src/b.ts"];

			const result = await run(
				Effect.flatMap(CoverageAnalyzer, (ca) =>
					ca.processScoped(
						map,
						{
							thresholds: {
								global: { lines: 80, functions: 80, branches: 80, statements: 80 },
								perFile: false,
								patterns: [],
							},
							includeBareZero: false,
						},
						testedFiles,
					),
				),
			);

			const report = Option.getOrThrow(result);
			expect(report.scopedFiles).toEqual(["src/a.ts", "src/b.ts"]);
		});

		it("does not flag out-of-scope files below threshold", async () => {
			const map = mockCoverageMap({
				"src/in-scope.ts": {
					summary: { statements: 95, branches: 95, functions: 95, lines: 95 },
					uncoveredLines: [],
				},
				"src/out-of-scope.ts": {
					summary: { statements: 10, branches: 10, functions: 10, lines: 10 },
					uncoveredLines: [1, 2, 3, 4, 5, 6, 7, 8, 9],
				},
			});

			const result = await run(
				Effect.flatMap(CoverageAnalyzer, (ca) =>
					ca.processScoped(
						map,
						{
							thresholds: {
								global: { lines: 80, functions: 80, branches: 80, statements: 80 },
								perFile: false,
								patterns: [],
							},
							includeBareZero: false,
						},
						["src/in-scope.ts"],
					),
				),
			);

			const report = Option.getOrThrow(result);
			expect(report.lowCoverage).toHaveLength(0);
			expect(report.lowCoverageFiles).toEqual([]);
		});
	});
});

describe("CoverageAnalyzerLive -- pattern thresholds and belowTarget", () => {
	it("uses pattern-specific threshold when file path matches a glob", async () => {
		const map = mockCoverageMap({
			"src/utils.ts": {
				summary: { statements: 60, branches: 60, functions: 60, lines: 60 },
				uncoveredLines: [10, 11],
			},
		});

		// Global threshold is 80, but pattern for src/utils.ts is only 50
		const result = await run(
			Effect.flatMap(CoverageAnalyzer, (ca) =>
				ca.process(map, {
					thresholds: {
						global: { lines: 80, functions: 80, branches: 80, statements: 80 },
						perFile: false,
						patterns: [["src/utils.ts", { lines: 50, functions: 50, branches: 50, statements: 50 }]],
					},
					includeBareZero: false,
				}),
			),
		);

		const report = Option.getOrThrow(result);
		// File is above the pattern threshold (60 > 50), so should NOT be in lowCoverage
		expect(report.lowCoverageFiles).not.toContain("src/utils.ts");
	});

	it("uses glob pattern matching with ** wildcard", async () => {
		const map = mockCoverageMap({
			"src/lib/deep/file.ts": {
				summary: { statements: 55, branches: 55, functions: 55, lines: 55 },
				uncoveredLines: [1, 2, 3],
			},
		});

		const result = await run(
			Effect.flatMap(CoverageAnalyzer, (ca) =>
				ca.process(map, {
					thresholds: {
						global: { lines: 80, functions: 80, branches: 80, statements: 80 },
						perFile: false,
						patterns: [["src/**/*.ts", { lines: 50, functions: 50, branches: 50, statements: 50 }]],
					},
					includeBareZero: false,
				}),
			),
		);

		const report = Option.getOrThrow(result);
		// 55 > 50 pattern threshold, so NOT in lowCoverage
		expect(report.lowCoverageFiles).not.toContain("src/lib/deep/file.ts");
	});

	it("populates belowTarget when file is above threshold but below target", async () => {
		const map = mockCoverageMap({
			"src/partial.ts": {
				summary: { statements: 75, branches: 75, functions: 75, lines: 75 },
				uncoveredLines: [20, 21, 22],
			},
		});

		const result = await run(
			Effect.flatMap(CoverageAnalyzer, (ca) =>
				ca.process(map, {
					thresholds: {
						global: { lines: 70, functions: 70, branches: 70, statements: 70 },
						perFile: false,
						patterns: [],
					},
					targets: {
						global: { lines: 90, functions: 90, branches: 90, statements: 90 },
						perFile: false,
						patterns: [],
					},
					includeBareZero: false,
				}),
			),
		);

		const report = Option.getOrThrow(result);
		// Above threshold (75 > 70) so NOT in lowCoverage
		expect(report.lowCoverageFiles).not.toContain("src/partial.ts");
		// Below target (75 < 90) so should be in belowTarget
		expect(report.belowTargetFiles).toContain("src/partial.ts");
		expect(report.belowTarget).toHaveLength(1);
	});

	it("does not populate belowTarget fields when no targets are configured", async () => {
		const map = mockCoverageMap({
			"src/a.ts": {
				summary: { statements: 95, branches: 95, functions: 95, lines: 95 },
				uncoveredLines: [],
			},
		});

		const result = await run(
			Effect.flatMap(CoverageAnalyzer, (ca) =>
				ca.process(map, {
					thresholds: {
						global: { lines: 80, functions: 80, branches: 80, statements: 80 },
						perFile: false,
						patterns: [],
					},
					includeBareZero: false,
				}),
			),
		);

		const report = Option.getOrThrow(result);
		expect(report.belowTarget).toBeUndefined();
		expect(report.belowTargetFiles).toBeUndefined();
	});
});

describe("CoverageAnalyzerTest", () => {
	it("process returns Option.some when data is provided", async () => {
		const cannedData: CoverageReport = {
			totals: { statements: 80, branches: 75, functions: 90, lines: 85 },
			thresholds: { global: { lines: 80, functions: 80, branches: 80, statements: 80 }, patterns: [] },
			scoped: false,
			lowCoverage: [],
			lowCoverageFiles: [],
		};

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.flatMap(CoverageAnalyzer, (ca) =>
					ca.process(null, {
						thresholds: {
							global: { lines: 80, functions: 80, branches: 80, statements: 80 },
							perFile: false,
							patterns: [],
						},
						includeBareZero: false,
					}),
				),
				CoverageAnalyzerTest.layer(cannedData),
			),
		);

		expect(Option.isSome(result)).toBe(true);
		const report = Option.getOrThrow(result);
		expect(report.totals.statements).toBe(80);
	});

	it("process returns Option.none when no data provided", async () => {
		const result = await Effect.runPromise(
			Effect.provide(
				Effect.flatMap(CoverageAnalyzer, (ca) =>
					ca.process(null, {
						thresholds: {
							global: { lines: 80, functions: 80, branches: 80, statements: 80 },
							perFile: false,
							patterns: [],
						},
						includeBareZero: false,
					}),
				),
				CoverageAnalyzerTest.layer(),
			),
		);

		expect(Option.isNone(result)).toBe(true);
	});

	it("processScoped returns Option.some when data is provided", async () => {
		const cannedData: CoverageReport = {
			totals: { statements: 90, branches: 85, functions: 95, lines: 88 },
			thresholds: { global: { lines: 80, functions: 80, branches: 80, statements: 80 }, patterns: [] },
			scoped: true,
			scopedFiles: ["src/a.ts"],
			lowCoverage: [],
			lowCoverageFiles: [],
		};

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.flatMap(CoverageAnalyzer, (ca) =>
					ca.processScoped(
						null,
						{
							thresholds: {
								global: { lines: 80, functions: 80, branches: 80, statements: 80 },
								perFile: false,
								patterns: [],
							},
							includeBareZero: false,
						},
						["src/a.ts"],
					),
				),
				CoverageAnalyzerTest.layer(cannedData),
			),
		);

		expect(Option.isSome(result)).toBe(true);
		const report = Option.getOrThrow(result);
		expect(report.scoped).toBe(true);
	});

	it("processScoped returns Option.none when no data provided", async () => {
		const result = await Effect.runPromise(
			Effect.provide(
				Effect.flatMap(CoverageAnalyzer, (ca) =>
					ca.processScoped(
						null,
						{
							thresholds: {
								global: { lines: 80, functions: 80, branches: 80, statements: 80 },
								perFile: false,
								patterns: [],
							},
							includeBareZero: false,
						},
						[],
					),
				),
				CoverageAnalyzerTest.layer(),
			),
		);

		expect(Option.isNone(result)).toBe(true);
	});
});
