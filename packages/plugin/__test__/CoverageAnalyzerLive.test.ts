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
	it("returns none for an empty coverage map (no test files)", async () => {
		// Istanbul reports pct as the string "Unknown" for every metric when
		// the coverage map has no files (e.g. `vitest run --passWithNoTests`
		// in a workspace with no tests). Producing a report from that map
		// leaks non-numeric totals into the baseline/trend writes (issue #130).
		const emptyIstanbulMap = {
			getCoverageSummary: () => ({
				statements: { pct: "Unknown" },
				branches: { pct: "Unknown" },
				functions: { pct: "Unknown" },
				lines: { pct: "Unknown" },
			}),
			files: () => [],
			fileCoverageFor: () => {
				throw new Error("no files in map");
			},
		};

		const result = await run(
			Effect.flatMap(CoverageAnalyzer, (ca) =>
				ca.process(emptyIstanbulMap, {
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
			// The map needs at least one file: an empty coverage map means no
			// coverage data and short-circuits to none (issue #130).
			const map = mockCoverageMap({
				"src/covered.ts": {
					summary: { statements: 95, branches: 90, functions: 100, lines: 92 },
					uncoveredLines: [],
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
						[],
					),
				),
			);

			const report = Option.getOrThrow(result);
			expect(report.scoped).toBe(true);
		});

		it("populates scopedFiles with input files", async () => {
			const map = mockCoverageMap({
				"src/covered.ts": {
					summary: { statements: 95, branches: 90, functions: 100, lines: 92 },
					uncoveredLines: [],
				},
			});
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

describe("pattern globbing (issue #381)", () => {
	// Vitest evaluates thresholds through picomatch, where `**/` spans zero or
	// more directories. A top-level file and a nested file must both match the
	// same `src/**/*.ts` pattern, or the analyzer disagrees with Vitest's
	// native threshold result for files at the top of the globbed directory.
	const files = {
		"src/index.ts": {
			summary: { statements: 55, branches: 55, functions: 55, lines: 55 },
			uncoveredLines: [1],
		},
		"src/lib/deep/file.ts": {
			summary: { statements: 55, branches: 55, functions: 55, lines: 55 },
			uncoveredLines: [1],
		},
		"lib/other.ts": {
			summary: { statements: 55, branches: 55, functions: 55, lines: 55 },
			uncoveredLines: [1],
		},
		"src/view.tsx": {
			summary: { statements: 55, branches: 55, functions: 55, lines: 55 },
			uncoveredLines: [1],
		},
		"src/.hidden.ts": {
			summary: { statements: 55, branches: 55, functions: 55, lines: 55 },
			uncoveredLines: [1],
		},
	};

	// `expectedLow` lists the files the pattern does NOT match — they fall
	// back to the 80% global thresholds and are flagged at 55%.
	it.each([
		["src/**/*.ts", ["lib/other.ts", "src/.hidden.ts", "src/view.tsx"]],
		["src/**", ["lib/other.ts", "src/.hidden.ts"]],
		["**/*.ts", ["src/.hidden.ts", "src/view.tsx"]],
		// Brace groups expand, as in Vitest's own threshold keys.
		["src/**/*.{ts,tsx}", ["lib/other.ts", "src/.hidden.ts"]],
		// Character classes and extglobs work.
		["src/[iv]*.ts?(x)", ["lib/other.ts", "src/.hidden.ts", "src/lib/deep/file.ts"]],
		// A malformed pattern matches nothing rather than throwing.
		["src/[", ["lib/other.ts", "src/.hidden.ts", "src/index.ts", "src/lib/deep/file.ts", "src/view.tsx"]],
	])("pattern %s matches like Vitest's picomatch threshold matcher", async (pattern, expectedLow) => {
		const result = await run(
			Effect.flatMap(CoverageAnalyzer, (ca) =>
				ca.process(mockCoverageMap(files), {
					thresholds: {
						global: { lines: 80, functions: 80, branches: 80, statements: 80 },
						perFile: false,
						patterns: [[pattern, { lines: 50, functions: 50, branches: 50, statements: 50 }]],
					},
					includeBareZero: false,
				}),
			),
		);
		const report = Option.getOrThrow(result);
		// Files the pattern matches use its 50% thresholds and pass at 55%;
		// only files outside the pattern fall back to the 80% global and fail.
		expect([...report.lowCoverageFiles].sort()).toEqual(expectedLow);
	});

	it("keeps * and ? from crossing a directory separator", async () => {
		const result = await run(
			Effect.flatMap(CoverageAnalyzer, (ca) =>
				ca.process(mockCoverageMap(files), {
					thresholds: {
						global: { lines: 80, functions: 80, branches: 80, statements: 80 },
						perFile: false,
						patterns: [["src/*.ts", { lines: 50, functions: 50, branches: 50, statements: 50 }]],
					},
					includeBareZero: false,
				}),
			),
		);
		const report = Option.getOrThrow(result);
		expect([...report.lowCoverageFiles].sort()).toEqual([
			"lib/other.ts",
			"src/.hidden.ts",
			"src/lib/deep/file.ts",
			"src/view.tsx",
		]);
	});
});

describe("root-relative matching (production shape)", () => {
	// The v8 / istanbul providers key the coverage map by ABSOLUTE path,
	// while threshold patterns and `testedFiles` (from
	// `TestModule.relativeModuleId`) are root-relative. With `root` set the
	// analyzer matches on `relative(root, key)`; the tests elsewhere in this
	// file that pass relative keys without `root` exercise the verbatim path.
	const ROOT = "/repo";
	const absolute = {
		"/repo/src/index.ts": {
			summary: { statements: 55, branches: 55, functions: 55, lines: 55 },
			uncoveredLines: [1],
		},
		"/repo/lib/other.ts": {
			summary: { statements: 55, branches: 55, functions: 55, lines: 55 },
			uncoveredLines: [1],
		},
	};

	it("matches a relative glob pattern against absolute coverage keys", async () => {
		const result = await run(
			Effect.flatMap(CoverageAnalyzer, (ca) =>
				ca.process(mockCoverageMap(absolute), {
					root: ROOT,
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
		// src/index.ts takes the pattern's 50% and passes; lib/other.ts falls
		// to the 80% global. The reported `file` keeps the absolute key.
		expect(report.lowCoverageFiles).toEqual(["/repo/lib/other.ts"]);
	});

	it("without root, a relative pattern never matches an absolute key (the pre-fix production behaviour)", async () => {
		const result = await run(
			Effect.flatMap(CoverageAnalyzer, (ca) =>
				ca.process(mockCoverageMap(absolute), {
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
		expect([...report.lowCoverageFiles].sort()).toEqual(["/repo/lib/other.ts", "/repo/src/index.ts"]);
	});

	it("intersects testedFiles with the raw coverage key on a scoped run, independent of root", async () => {
		// `testedFiles` come from the absolute `TestModule.moduleId`, so the
		// membership test is absolute-to-absolute and never depends on which
		// project's root `relativeModuleId` happened to be relative to.
		const result = await run(
			Effect.flatMap(CoverageAnalyzer, (ca) =>
				ca.processScoped(
					mockCoverageMap(absolute),
					{
						root: ROOT,
						thresholds: {
							global: { lines: 80, functions: 80, branches: 80, statements: 80 },
							perFile: false,
							patterns: [],
						},
						includeBareZero: false,
					},
					["/repo/src/index.ts"],
				),
			),
		);
		const report = Option.getOrThrow(result);
		expect(report.lowCoverageFiles).toEqual(["/repo/src/index.ts"]);
		expect(report.scopedFiles).toEqual(["/repo/src/index.ts"]);
	});

	it("normalizes separators on both sides of the scoped membership test (Windows v8 keys)", async () => {
		// On Windows `moduleId` is forward-slash (Vitest slashes test paths)
		// while the v8 provider keys the coverage map with backslashes.
		const windowsKeys = {
			"C:\\repo\\src\\index.ts": {
				summary: { statements: 55, branches: 55, functions: 55, lines: 55 },
				uncoveredLines: [1],
			},
			"C:\\repo\\lib\\other.ts": {
				summary: { statements: 55, branches: 55, functions: 55, lines: 55 },
				uncoveredLines: [1],
			},
		};
		const result = await run(
			Effect.flatMap(CoverageAnalyzer, (ca) =>
				ca.processScoped(
					mockCoverageMap(windowsKeys),
					{
						thresholds: {
							global: { lines: 80, functions: 80, branches: 80, statements: 80 },
							perFile: false,
							patterns: [],
						},
						includeBareZero: false,
					},
					["C:/repo/src/index.ts"],
				),
			),
		);
		const report = Option.getOrThrow(result);
		// Flagged, and reported under the provider's original key.
		expect(report.lowCoverageFiles).toEqual(["C:\\repo\\src\\index.ts"]);
	});

	it("does not relativize testedFiles: a root-relative entry never matches an absolute key", async () => {
		const result = await run(
			Effect.flatMap(CoverageAnalyzer, (ca) =>
				ca.processScoped(
					mockCoverageMap(absolute),
					{
						root: ROOT,
						thresholds: {
							global: { lines: 80, functions: 80, branches: 80, statements: 80 },
							perFile: false,
							patterns: [],
						},
						includeBareZero: false,
					},
					["src/index.ts"],
				),
			),
		);
		const report = Option.getOrThrow(result);
		expect(report.lowCoverageFiles).toEqual([]);
	});
});

describe("per-pattern perFile", () => {
	it("uses an object-valued pattern perFile as the per-file threshold set", async () => {
		// A file at 80% lines: above the pattern's aggregate 90% requirement is
		// false, but the pattern's own perFile object only requires 70% lines,
		// so the file must NOT be flagged as low coverage.
		const map = mockCoverageMap({
			"/repo/src/a.ts": {
				summary: { statements: 80, branches: 80, functions: 80, lines: 80 },
				uncoveredLines: [],
			},
		});

		const result = await run(
			Effect.flatMap(CoverageAnalyzer, (ca) =>
				ca.process(map, {
					thresholds: {
						global: { lines: 90 },
						perFile: false,
						patterns: [["/repo/src/*.ts", { lines: 90, perFile: { lines: 70 } }]],
					},
					includeBareZero: false,
				}),
			),
		);

		const report = Option.getOrThrow(result);
		expect(report.lowCoverage.map((f) => f.file)).toEqual([]);
	});

	it("flags a file below an object-valued pattern perFile", async () => {
		const map = mockCoverageMap({
			"/repo/src/a.ts": {
				summary: { statements: 60, branches: 60, functions: 60, lines: 60 },
				uncoveredLines: [1],
			},
		});

		const result = await run(
			Effect.flatMap(CoverageAnalyzer, (ca) =>
				ca.process(map, {
					thresholds: {
						global: { lines: 10 },
						perFile: false,
						patterns: [["/repo/src/*.ts", { lines: 10, perFile: { lines: 70 } }]],
					},
					includeBareZero: false,
				}),
			),
		);

		const report = Option.getOrThrow(result);
		expect(report.lowCoverage.map((f) => f.file)).toEqual(["/repo/src/a.ts"]);
	});
	it("does not let a matched pattern without a perFile inherit the top-level one", async () => {
		// Vitest 5: a matched glob entry's own perFile is the ONLY per-file
		// setting for that file. The pattern declares none, so the top-level
		// `perFile: { lines: 90 }` must not reach this file — it is checked
		// against the pattern's own `lines: 50`, which 60% clears.
		const map = mockCoverageMap({
			"/repo/src/a.ts": {
				summary: { statements: 60, branches: 60, functions: 60, lines: 60 },
				uncoveredLines: [1],
			},
		});

		const result = await run(
			Effect.flatMap(CoverageAnalyzer, (ca) =>
				ca.process(map, {
					thresholds: {
						global: { lines: 50 },
						perFile: { lines: 90 },
						patterns: [["/repo/src/*.ts", { lines: 50 }]],
					},
					includeBareZero: false,
				}),
			),
		);

		const report = Option.getOrThrow(result);
		expect(report.lowCoverage.map((f) => f.file)).toEqual([]);
	});

	it("falls through to the pattern metrics when the pattern perFile is boolean", async () => {
		// A boolean pattern perFile carries no metric numbers, so the resolver
		// returns null and the file is checked against the pattern's own
		// aggregate metrics — here `lines: 90`, which 60% fails.
		const map = mockCoverageMap({
			"/repo/src/a.ts": {
				summary: { statements: 60, branches: 60, functions: 60, lines: 60 },
				uncoveredLines: [1],
			},
		});

		const result = await run(
			Effect.flatMap(CoverageAnalyzer, (ca) =>
				ca.process(map, {
					thresholds: {
						global: { lines: 10 },
						perFile: false,
						patterns: [["/repo/src/*.ts", { lines: 90, perFile: true }]],
					},
					includeBareZero: false,
				}),
			),
		);

		const report = Option.getOrThrow(result);
		expect(report.lowCoverage.map((f) => f.file)).toEqual(["/repo/src/a.ts"]);
	});
});
