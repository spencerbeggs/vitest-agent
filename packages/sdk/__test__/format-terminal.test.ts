import { describe, expect, it } from "vitest";
import type { AgentReport } from "../src/schemas/AgentReport.js";
import type { CoverageReport } from "../src/schemas/Coverage.js";
import type { MetricThresholds } from "../src/schemas/Thresholds.js";
import { formatTerminal } from "../src/utils/format-terminal.js";

const baseReport = (overrides: Partial<AgentReport> = {}): AgentReport => ({
	timestamp: "2026-04-29T00:00:00Z",
	reason: "passed",
	summary: { total: 0, passed: 0, failed: 0, skipped: 0, duration: 0 },
	failed: [],
	unhandledErrors: [],
	failedFiles: [],
	...overrides,
});

const coverage = (
	overrides: Partial<CoverageReport> & {
		thresholdsGlobal?: MetricThresholds;
		targetsGlobal?: MetricThresholds;
	} = {},
): CoverageReport => {
	const { thresholdsGlobal, targetsGlobal, ...rest } = overrides;
	return {
		totals: { lines: 100, branches: 100, functions: 100, statements: 100 },
		thresholds: {
			global: thresholdsGlobal ?? { lines: 80, branches: 80, functions: 80, statements: 80 },
			patterns: [],
		},
		...(targetsGlobal !== undefined ? { targets: { global: targetsGlobal, patterns: [] } } : {}),
		lowCoverage: [],
		lowCoverageFiles: [],
		...rest,
	} as CoverageReport;
};

const baseOptions = { noColor: true, coverageConsoleLimit: 10 };

describe("formatTerminal", () => {
	it("emits the single-default-project shape for one unnamed report", () => {
		const out = formatTerminal(
			[
				baseReport({
					summary: { total: 8, passed: 8, failed: 0, skipped: 0, duration: 42 },
				}),
			],
			baseOptions,
		);
		expect(out).not.toContain("Project");
		expect(out).not.toContain("##");
		expect(out).not.toContain("`");
		expect(out).toContain("✓ 8 passed (42ms)");
		expect(out).toContain("Total: 8 passed (42ms)");
	});

	it("emits Project header and indented row when single named project", () => {
		const out = formatTerminal(
			[
				baseReport({
					project: "my-app",
					summary: { total: 12, passed: 12, failed: 0, skipped: 0, duration: 1500 },
				}),
			],
			baseOptions,
		);
		expect(out).toContain("Project: my-app");
		expect(out).toContain("✓ 12 passed (1.5s)");
		expect(out).toContain("Total: 12 passed (1.5s)");
	});

	it("emits Projects (N) header for multi-project runs", () => {
		const out = formatTerminal(
			[
				baseReport({
					project: "shared",
					summary: { total: 545, passed: 545, failed: 0, skipped: 0, duration: 5577 },
				}),
				baseReport({
					project: "reporter",
					summary: { total: 103, passed: 103, failed: 0, skipped: 0, duration: 2106 },
				}),
			],
			baseOptions,
		);
		expect(out).toContain("Projects (2):");
		expect(out).toContain("  ✓ shared  ");
		expect(out).toContain("545 passed (5.6s)");
		expect(out).toContain("103 passed (2.1s)");
		expect(out).toContain("Total: 648 passed (5.6s)");
		expect(out).not.toContain("##");
	});

	it("renders the failure section with project grouping and re-run hints", () => {
		const out = formatTerminal(
			[
				baseReport({
					project: "reporter",
					reason: "failed",
					summary: { total: 1, passed: 0, failed: 1, skipped: 0, duration: 50 },
					failed: [
						{
							file: "src/foo.test.ts",
							state: "failed",
							tests: [
								{
									name: "rejects empty",
									fullName: "Foo > rejects empty",
									state: "failed",
									errors: [{ message: "expected ValidationError" }],
									classification: "new-failure",
								},
							],
						},
					],
					failedFiles: ["src/foo.test.ts"],
					unhandledErrors: [],
				}),
			],
			baseOptions,
		);
		expect(out).toContain("Failures:");
		expect(out).toContain("reporter");
		expect(out).toContain("✗ src/foo.test.ts > Foo > rejects empty");
		expect(out).toContain("[new-failure]");
		expect(out).toContain("expected ValidationError");
		expect(out).toContain("Total: 1 failed, 0 passed (50ms)");
		expect(out).toContain("Next steps:");
		expect(out).toContain("Re-run: pnpm vitest run src/foo.test.ts");
	});

	it("collapses coverage to a single met-line when thresholds and targets are both satisfied", () => {
		const out = formatTerminal(
			[
				baseReport({
					summary: { total: 1, passed: 1, failed: 0, skipped: 0, duration: 10 },
					coverage: coverage({
						targetsGlobal: { lines: 80, branches: 80, functions: 80, statements: 80 },
						belowTarget: [],
					}),
				}),
			],
			baseOptions,
		);
		expect(out).toContain(
			"Coverage: ✓ minimum thresholds + aspirational targets met (lines, branches, funcs, stmts ≥ 80%)",
		);
		expect(out).not.toContain("Files below aspirational target:");
	});

	it("renders Files below target rows as a v8-style coverage table", () => {
		const out = formatTerminal(
			[
				baseReport({
					summary: { total: 1, passed: 1, failed: 0, skipped: 0, duration: 10 },
					coverage: coverage({
						totals: { lines: 67, branches: 75, functions: 33, statements: 67 },
						thresholdsGlobal: { lines: 0, branches: 0, functions: 0, statements: 0 },
						targetsGlobal: { lines: 80, branches: 80, functions: 80, statements: 80 },
						belowTarget: [
							{
								file: "/repo/cli/src/lib/record-turn.ts",
								summary: { lines: 67, branches: 75, functions: 33, statements: 67 },
								uncoveredLines: "29-32, 34-38, 42, 48",
							},
						],
					}),
				}),
			],
			{ ...baseOptions },
		);
		expect(out).toContain("Coverage: ✓ minimum thresholds met");
		expect(out).toContain("Coverage: ⚠ 1 file below aspirational targets");
		expect(out).toContain("Files below aspirational target:");
		// v8-style table: header row, separator, single data row.
		expect(out).toMatch(/File\s+\|\s+% Stmts\s+\|\s+% Branch\s+\|\s+% Funcs\s+\|\s+% Lines\s+\|\s+Uncovered Line #s/);
		expect(out).toContain("record-turn.ts");
		// Each metric appears as an integer in its own column. Use a regex
		// to confirm the row carries 67/75/33/67 in order plus the
		// compressed uncov ranges.
		expect(out).toMatch(/record-turn\.ts\s+\|\s+67\s+\|\s+75\s+\|\s+33\s+\|\s+67\s+\|\s+29-32, 34-38, 42, 48/);
	});

	it("flags below-threshold coverage as a failure-tier coverage row", () => {
		const out = formatTerminal(
			[
				baseReport({
					summary: { total: 1, passed: 1, failed: 0, skipped: 0, duration: 10 },
					coverage: coverage({
						totals: { lines: 50, branches: 50, functions: 50, statements: 50 },
						thresholdsGlobal: { lines: 80, branches: 80, functions: 80, statements: 80 },
						lowCoverage: [
							{
								file: "/repo/src/x.ts",
								summary: { lines: 50, branches: 50, functions: 50, statements: 50 },
								uncoveredLines: "1-50",
							},
						],
						lowCoverageFiles: ["/repo/src/x.ts"],
						belowTarget: [],
					}),
				}),
			],
			baseOptions,
		);
		expect(out).toContain("Coverage: ✗ 1 file below minimum thresholds");
		expect(out).not.toContain("aspirational targets met");
	});

	it("includes a Trend line when trendSummary is provided", () => {
		const out = formatTerminal(
			[
				baseReport({
					summary: { total: 1, passed: 1, failed: 0, skipped: 0, duration: 10 },
					coverage: coverage(),
				}),
			],
			{
				...baseOptions,
				trendSummary: { direction: "stable", runCount: 50 },
			},
		);
		expect(out).toContain("Trend: stable (50 runs)");
	});

	it("emits no markdown syntax in any branch", () => {
		const out = formatTerminal(
			[
				baseReport({
					project: "p",
					reason: "failed",
					summary: { total: 2, passed: 1, failed: 1, skipped: 0, duration: 100 },
					failed: [
						{
							file: "src/x.test.ts",
							state: "failed",
							tests: [
								{
									name: "fails",
									fullName: "X > fails",
									state: "failed",
									errors: [{ message: "boom" }],
								},
							],
						},
					],
					failedFiles: ["src/x.test.ts"],
				}),
			],
			baseOptions,
		);
		expect(out).not.toMatch(/^#/m);
		expect(out).not.toContain("```");
		expect(out).not.toMatch(/^- /m);
	});

	// Coverage gap tests — each targets a specific previously-uncovered
	// branch in format-terminal.ts. Production source is unchanged;
	// these are pure additions that exercise branches the original
	// suite did not reach.
	it("compresses an uncompressed comma-separated uncoveredLines string into ranges", () => {
		// compressUncov: when uncoveredLines lacks "-" we parse each
		// piece, populate the numbers array, and call compressLines.
		// Covers the for-loop body and the success return path.
		const out = formatTerminal(
			[
				baseReport({
					summary: { total: 1, passed: 1, failed: 0, skipped: 0, duration: 10 },
					coverage: coverage({
						totals: { lines: 67, branches: 75, functions: 33, statements: 67 },
						thresholdsGlobal: { lines: 0, branches: 0, functions: 0, statements: 0 },
						targetsGlobal: { lines: 80, branches: 80, functions: 80, statements: 80 },
						belowTarget: [
							{
								file: "/repo/src/uncompressed.ts",
								summary: { lines: 67, branches: 75, functions: 33, statements: 67 },
								// Uncompressed: consecutive integers separated by commas
								// without any hyphens; compressUncov should produce
								// "1-3,5,10-12".
								uncoveredLines: "1,2,3,5,10,11,12",
							},
						],
					}),
				}),
			],
			baseOptions,
		);
		expect(out).toContain("1-3,5,10-12");
	});

	it("returns the original string when an uncoveredLines piece is non-numeric", () => {
		// compressUncov: Number.isNaN(n) early-return path. When any
		// piece fails to parse we surface the original string verbatim
		// rather than throwing or producing a partial compression.
		const out = formatTerminal(
			[
				baseReport({
					summary: { total: 1, passed: 1, failed: 0, skipped: 0, duration: 10 },
					coverage: coverage({
						totals: { lines: 50, branches: 50, functions: 50, statements: 50 },
						thresholdsGlobal: { lines: 0, branches: 0, functions: 0, statements: 0 },
						targetsGlobal: { lines: 80, branches: 80, functions: 80, statements: 80 },
						belowTarget: [
							{
								file: "/repo/src/garbage.ts",
								summary: { lines: 50, branches: 50, functions: 50, statements: 50 },
								// "abc" cannot be parsed; the function should bail
								// and return the original string unchanged.
								uncoveredLines: "1,abc,3",
							},
						],
					}),
				}),
			],
			baseOptions,
		);
		expect(out).toContain("1,abc,3");
	});

	it("formats target spec per-metric when targets differ across metrics", () => {
		// formatTargetSpec: set.size !== 1 branch. With distinct values
		// per metric the function emits per-metric pairs joined by
		// commas instead of collapsing to one shared "≥ N%" suffix.
		const out = formatTerminal(
			[
				baseReport({
					summary: { total: 1, passed: 1, failed: 0, skipped: 0, duration: 10 },
					coverage: coverage({
						totals: { lines: 100, branches: 100, functions: 100, statements: 100 },
						thresholdsGlobal: { lines: 90, branches: 80, functions: 70, statements: 85 },
						belowTarget: [],
					}),
				}),
			],
			baseOptions,
		);
		// Per-metric form: each metric carries its own threshold value.
		expect(out).toContain("lines ≥ 90%, branches ≥ 80%, funcs ≥ 70%, stmts ≥ 85%");
	});

	it("appends a truncation footer when more below-target files than the console limit", () => {
		// renderCoverageSection: belowTargetFiles.length > limit branch.
		// With a limit of 1 and two below-target files we expect the
		// footer "… 1 more (run …)".
		const out = formatTerminal(
			[
				baseReport({
					summary: { total: 1, passed: 1, failed: 0, skipped: 0, duration: 10 },
					coverage: coverage({
						totals: { lines: 60, branches: 60, functions: 60, statements: 60 },
						thresholdsGlobal: { lines: 0, branches: 0, functions: 0, statements: 0 },
						targetsGlobal: { lines: 80, branches: 80, functions: 80, statements: 80 },
						belowTarget: [
							{
								file: "/repo/src/a.ts",
								summary: { lines: 60, branches: 60, functions: 60, statements: 60 },
								uncoveredLines: "1-10",
							},
							{
								file: "/repo/src/b.ts",
								summary: { lines: 60, branches: 60, functions: 60, statements: 60 },
								uncoveredLines: "20-30",
							},
						],
					}),
				}),
			],
			{ noColor: true, coverageConsoleLimit: 1 },
		);
		expect(out).toContain("… 1 more (run `vitest-agent coverage` for full list)");
	});

	it("renders module-level errors inside the failures section", () => {
		// renderFailuresSection: mod.errors loop. Module-level errors
		// (errors that fired outside any specific test, e.g. import
		// failures) render under the project header with a "(module-level
		// error)" suffix and the underlying message.
		const out = formatTerminal(
			[
				baseReport({
					project: "reporter",
					reason: "failed",
					summary: { total: 1, passed: 0, failed: 1, skipped: 0, duration: 50 },
					failed: [
						{
							file: "src/broken.test.ts",
							state: "failed",
							errors: [{ message: "ImportError: cannot find module" }],
							tests: [],
						},
					],
					failedFiles: ["src/broken.test.ts"],
				}),
			],
			baseOptions,
		);
		expect(out).toContain("Failures:");
		expect(out).toContain("src/broken.test.ts (module-level error)");
		expect(out).toContain("ImportError: cannot find module");
	});

	it("renders unhandled errors after the per-module failures", () => {
		// renderFailuresSection: report.unhandledErrors loop. The
		// filter at the top of the function admits a report when
		// unhandledErrors.length > 0 even if summary.failed is 0,
		// so the loop body is reachable here.
		const out = formatTerminal(
			[
				baseReport({
					project: "reporter",
					reason: "failed",
					summary: { total: 0, passed: 0, failed: 0, skipped: 0, duration: 5 },
					failed: [],
					unhandledErrors: [{ message: "ENOENT: missing fixture" }],
					failedFiles: [],
				}),
			],
			baseOptions,
		);
		expect(out).toContain("Failures:");
		expect(out).toContain("unhandled error");
		expect(out).toContain("ENOENT: missing fixture");
	});

	it("suggests MCP tools instead of CLI hints in Next steps when mcp option is set", () => {
		// renderNextSteps: options.mcp branch. With at least one failed
		// file the function emits the Re-run line plus, when mcp=true,
		// two extra lines pointing at the test_history and test_errors
		// MCP tools.
		const out = formatTerminal(
			[
				baseReport({
					reason: "failed",
					summary: { total: 1, passed: 0, failed: 1, skipped: 0, duration: 12 },
					failed: [
						{
							file: "src/x.test.ts",
							state: "failed",
							tests: [
								{
									name: "fails",
									fullName: "X > fails",
									state: "failed",
									errors: [{ message: "boom" }],
								},
							],
						},
					],
					failedFiles: ["src/x.test.ts"],
				}),
			],
			{ ...baseOptions, mcp: true },
		);
		expect(out).toContain("Use the test_history MCP tool to check failure trends");
		expect(out).toContain("Use the test_errors MCP tool to search errors by type");
	});
});
