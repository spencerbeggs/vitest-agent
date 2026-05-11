/**
 * vitest-agent-sdk
 *
 * Pure function for formatting an {@link AgentReport} as console markdown.
 * Designed for LLM agent consumption: compact, actionable, no noise.
 *
 * @packageDocumentation
 */

import type { AgentReport } from "../schemas/AgentReport.js";
import type { FileCoverageReport } from "../schemas/Coverage.js";
import type { AnsiOptions } from "./ansi.js";
import { ansi } from "./ansi.js";

// --- Options ---

/**
 * Options controlling console markdown output formatting.
 *
 * @internal
 */
export interface ConsoleFormatOptions {
	/** Output verbosity: `"failures"` (default), `"full"`, or `"silent"`. */
	consoleOutput: "failures" | "full" | "silent";
	/** Maximum number of low-coverage files to show in console output. */
	coverageConsoleLimit: number;
	/** When `true`, suppress ANSI color codes for valid plain markdown. */
	noColor: boolean;
	/** Optional trend summary for tiered coverage output. */
	trendSummary?: {
		direction: "improving" | "regressing" | "stable";
		runCount: number;
		firstMetric?: { name: string; from: number; to: number; target?: number };
	};
	/** CLI run command prefix for coverage/trends hints (e.g., `"pnpm vitest-agent"`). */
	runCommand?: string;
	/** When true, suggest MCP tools instead of CLI commands in Next Steps. */
	mcp?: boolean;
}

// --- Helpers ---

/**
 * Return the metric with the lowest percentage from a {@link FileCoverageReport}.
 *
 * @remarks
 * Used to surface the single worst coverage metric per file in console output,
 * keeping the display compact. Labels are abbreviated: `"Stmts"`, `"Branch"`,
 * `"Funcs"`, `"Lines"`.
 *
 * @param f - File coverage report to analyze
 * @returns Object with `label` and `pct` of the worst metric
 *
 * @internal
 */
export function getWorstMetric(f: FileCoverageReport): { label: string; pct: number } {
	const metrics = [
		{ label: "Stmts", pct: f.summary.statements },
		{ label: "Branch", pct: f.summary.branches },
		{ label: "Funcs", pct: f.summary.functions },
		{ label: "Lines", pct: f.summary.lines },
	];
	return metrics.reduce((worst, m) => (m.pct < worst.pct ? m : worst));
}

/**
 * Strip the working directory prefix from a file path to produce a
 * project-relative path for display.
 *
 * @param filePath - Absolute or relative file path
 * @param cwd - Working directory to strip; defaults to `process.cwd()`
 * @returns Project-relative path string
 *
 * @internal
 */
export function relativePath(filePath: string, cwd?: string): string {
	const root = cwd ?? process.cwd();
	if (filePath.startsWith(root)) {
		const rel = filePath.slice(root.length);
		return rel.startsWith("/") ? rel.slice(1) : rel;
	}
	return filePath;
}

// --- Tier determination ---

/**
 * Determine the output tier based on test results and coverage state.
 *
 * - `"red"` -- failures, unhandled errors, or files below threshold
 * - `"yellow"` -- all tests pass but coverage targets exist (room to improve)
 * - `"green"` -- all tests pass, all coverage targets met
 *
 * @internal
 */
export function determineTier(report: AgentReport): "green" | "yellow" | "red" {
	if (report.summary.failed > 0 || report.unhandledErrors.length > 0) return "red";
	if (report.coverage) {
		if (report.coverage.lowCoverage.length > 0) return "red";
		if (report.coverage.targets && report.coverage.belowTarget && report.coverage.belowTarget.length > 0) {
			return "yellow";
		}
	}
	return "green";
}

// --- Main formatter ---

/**
 * Format an {@link AgentReport} as compact, actionable console markdown.
 *
 * @remarks
 * The output is structured for LLM agent consumption with four sections:
 *
 * 1. **Compact header** with pass/fail counts and duration
 * 2. **Failed test details** with error messages and diffs (the core value)
 * 3. **Coverage gaps** showing only files below threshold, worst metric first
 * 4. **Next steps** with re-run commands and cache file pointer
 *
 * When all tests pass, the output collapses to a single success line
 * with an optional cache file reference.
 *
 * Returns an empty string when `consoleOutput` is `"silent"`.
 *
 * @param report - The report to format
 * @param options - Formatting options controlling verbosity and color
 * @returns Formatted markdown string, or empty string for silent mode
 *
 * @internal
 */
export function formatConsoleMarkdown(report: AgentReport, options: ConsoleFormatOptions): string {
	const { consoleOutput, coverageConsoleLimit, noColor } = options;

	if (consoleOutput === "silent") return "";

	const ao: AnsiOptions = { noColor };
	const lines: string[] = [];
	const hasFailures = report.summary.failed > 0;
	const duration = Math.round(report.summary.duration);
	const projectLabel = report.project ? ` (${report.project})` : "";

	// 1. Compact header
	if (hasFailures) {
		lines.push(
			`## ${ansi("\u2717", "red", ao)} Vitest${projectLabel} \u2014 ${report.summary.failed} failed, ${report.summary.passed} passed (${duration}ms)`,
		);
	} else {
		lines.push(
			`## ${ansi("\u2713", "green", ao)} Vitest${projectLabel} \u2014 ${report.summary.passed} passed (${duration}ms)`,
		);
	}
	lines.push("");

	// 1b. Trend summary line (optional, tiered)
	if (options.trendSummary && report.coverage) {
		const { direction, runCount, firstMetric } = options.trendSummary;
		const tier = determineTier(report);

		if (tier === "green") {
			// Green tier: append trend inline to the header (no separate line)
			const trendNote = `Coverage: all targets met | trending ${direction} over ${runCount} runs`;
			lines[0] = `${lines[0]} — ${trendNote}`;
		} else if (tier === "yellow") {
			const belowTargetCount = report.coverage.belowTarget?.length ?? 0;
			let summary = `Coverage: ${belowTargetCount} file${belowTargetCount !== 1 ? "s" : ""} below target`;
			summary += ` | trending ${direction} over ${runCount} runs`;
			if (firstMetric) {
				summary += ` (${firstMetric.name}: ${firstMetric.from}% -> ${firstMetric.to}%`;
				if (firstMetric.target) summary += `, target: ${firstMetric.target}%`;
				summary += ")";
			}
			lines.push(summary);
			if (options.runCommand) {
				lines.push(`Run \`${options.runCommand} coverage\` for detailed gap analysis`);
			}
			lines.push("");
		} else {
			let summary = "Coverage:";
			if (report.coverage.lowCoverage.length > 0) {
				summary += ` ${report.coverage.lowCoverage.length} file${report.coverage.lowCoverage.length !== 1 ? "s" : ""} below threshold`;
			}
			summary += ` | trending ${direction} over ${runCount} runs`;
			if (firstMetric) {
				summary += ` (${firstMetric.name}: ${firstMetric.from}% -> ${firstMetric.to}%)`;
			}
			lines.push(summary);
			if (options.runCommand) {
				lines.push(`Run \`${options.runCommand} coverage\` for detailed gap analysis`);
				lines.push(`Run \`${options.runCommand} trends\` to check if this is a pattern`);
			}
			lines.push("");
		}
	}

	// 2. Failed tests with diffs
	if (hasFailures) {
		for (const mod of report.failed) {
			const file = relativePath(mod.file);
			lines.push(`### ${ansi("\u2717", "red", ao)} \`${file}\``);
			lines.push("");

			// Module-level errors
			if (mod.errors && mod.errors.length > 0) {
				for (const err of mod.errors) {
					lines.push(ansi(err.message, "red", ao));
					if (err.diff) {
						lines.push("");
						lines.push("```diff");
						lines.push(err.diff);
						lines.push("```");
					}
					lines.push("");
				}
			}

			// Failed tests
			const failedTests = mod.tests.filter((t) => t.state === "failed");
			for (const test of failedTests) {
				const label = test.classification ? ` [${test.classification}]` : "";
				lines.push(`- ${ansi("\u2717", "red", ao)} **${test.fullName}**${label}`);
				if (test.errors && test.errors.length > 0) {
					for (const err of test.errors) {
						lines.push(`  ${ansi(err.message, "dim", ao)}`);
						if (err.diff) {
							lines.push("");
							lines.push("  ```diff");
							for (const diffLine of err.diff.split("\n")) {
								lines.push(`  ${diffLine}`);
							}
							lines.push("  ```");
						}
					}
				}
				lines.push("");
			}
		}
	}

	// 3. Coverage gaps (only low-coverage files, no totals table)
	if (report.coverage) {
		const cov = report.coverage;
		const globalThresholds = cov.thresholds.global;
		const filesToShow = cov.lowCoverage.slice(0, coverageConsoleLimit);
		if (filesToShow.length > 0) {
			lines.push(`### Coverage gaps`);
			lines.push("");
			for (const f of filesToShow) {
				const file = relativePath(f.file);
				const worst = getWorstMetric(f);
				// Look up the threshold for the worst metric
				const metricKey =
					worst.label === "Stmts"
						? "statements"
						: worst.label === "Branch"
							? "branches"
							: worst.label === "Funcs"
								? "functions"
								: "lines";
				const thresholdValue = globalThresholds[metricKey];
				const thresholdSuffix = thresholdValue != null ? ` (threshold: ${thresholdValue}%)` : "";
				lines.push(
					`- \`${file}\` \u2014 ${worst.label}: ${worst.pct}%${thresholdSuffix} \u2014 uncovered: ${f.uncoveredLines}`,
				);
			}
			lines.push("");
		}

		// Coverage improvements: files above threshold but below target
		if (cov.targets && cov.belowTarget && cov.belowTarget.length > 0) {
			lines.push(`### Coverage improvements needed`);
			lines.push("");
			for (const f of cov.belowTarget.slice(0, coverageConsoleLimit)) {
				const file = relativePath(f.file);
				const worst = getWorstMetric(f);
				const metricKey =
					worst.label === "Stmts"
						? "statements"
						: worst.label === "Branch"
							? "branches"
							: worst.label === "Funcs"
								? "functions"
								: "lines";
				const targetValue = cov.targets.global[metricKey];
				const targetSuffix = targetValue != null ? ` (target: ${targetValue}%)` : "";
				lines.push(
					`- \`${file}\` \u2014 ${worst.label}: ${worst.pct}%${targetSuffix} \u2014 uncovered: ${f.uncoveredLines}`,
				);
			}
			lines.push("");
		}
	}

	// 4. Next steps
	if (hasFailures || (report.coverage && report.coverage.lowCoverage.length > 0)) {
		lines.push("### Next steps");
		lines.push("");
		if (hasFailures) {
			// Collect classifications from failed tests
			const allFailedTests = report.failed.flatMap((m) => m.tests.filter((t) => t.state === "failed"));
			const newFailures = allFailedTests.filter((t) => t.classification === "new-failure");
			const persistent = allFailedTests.filter((t) => t.classification === "persistent");
			const flaky = allFailedTests.filter((t) => t.classification === "flaky");
			const hasClassifications = newFailures.length > 0 || persistent.length > 0 || flaky.length > 0;

			if (newFailures.length > 0) {
				const files = [
					...new Set(
						report.failed
							.filter((m) => m.tests.some((t) => t.classification === "new-failure"))
							.map((m) => relativePath(m.file)),
					),
				];
				lines.push(
					`- Fix ${newFailures.length} new failure${newFailures.length > 1 ? "s" : ""} in ${files.map((f) => `\`${f}\``).join(", ")} (likely caused by recent changes)`,
				);
			}
			if (persistent.length > 0) {
				lines.push(
					`- ${persistent.length} persistent failure${persistent.length > 1 ? "s" : ""} (pre-existing, may not be yours)`,
				);
			}
			if (flaky.length > 0) {
				lines.push(`- ${flaky.length} flaky test${flaky.length > 1 ? "s" : ""} (may pass on retry)`);
			}

			for (const file of report.failedFiles) {
				lines.push(`- Re-run: \`vitest run ${relativePath(file)}\``);
			}
			if (options.mcp) {
				lines.push("- Use `test_history` for failure trends");
				lines.push("- Use `test_errors` to search errors by type");
				lines.push("- Use `test_coverage` for coverage gap analysis");
				lines.push('- Use `note({ action: "create" })` to record debugging findings');
			} else if (hasClassifications) {
				lines.push(`- Run \`vitest-agent history\` for failure trends`);
			}
		}
		lines.push("");
	}

	return lines.join("\n");
}
