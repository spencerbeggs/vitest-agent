import type { AgentReport } from "../schemas/AgentReport.js";
import type { FileCoverageReport } from "../schemas/Coverage.js";

// --- Helpers ---

/**
 * Format a number as a percentage string.
 *
 * @internal
 */
function pct(n: number): string {
	return `${n}%`;
}

/**
 * Find the worst (lowest) coverage metric for a file.
 *
 * @internal
 */
function worstCoverage(f: FileCoverageReport): { label: string; pct: number } {
	const metrics = [
		{ label: "Stmts", pct: f.summary.statements },
		{ label: "Branch", pct: f.summary.branches },
		{ label: "Funcs", pct: f.summary.functions },
		{ label: "Lines", pct: f.summary.lines },
	];
	return metrics.reduce((worst, m) => (m.pct < worst.pct ? m : worst));
}

/**
 * Format the body of a single project's GFM output.
 *
 * @internal
 */
function formatProjectBody(report: AgentReport): string[] {
	const lines: string[] = [];

	// Failed tests section
	if (report.failed.length > 0) {
		lines.push("## Failed Tests");
		lines.push("");

		for (const mod of report.failed) {
			lines.push(`### \`${mod.file}\``);
			lines.push("");

			// Module-level errors
			if (mod.errors && mod.errors.length > 0) {
				for (const err of mod.errors) {
					lines.push(`> ${err.message}`);
					if (err.diff) {
						lines.push("");
						lines.push("```diff");
						lines.push(err.diff);
						lines.push("```");
					}
					lines.push("");
				}
			}

			// Per-test failures
			const failedTests = mod.tests.filter((t) => t.state === "failed");
			for (const test of failedTests) {
				lines.push(`**${test.fullName}**`);
				lines.push("");
				if (test.errors && test.errors.length > 0) {
					for (const err of test.errors) {
						lines.push(`> ${err.message}`);
						if (err.diff) {
							lines.push("");
							lines.push("```diff");
							lines.push(err.diff);
							lines.push("```");
						}
					}
				}
				lines.push("");
			}
		}
	}

	// Coverage section
	if (report.coverage) {
		const cov = report.coverage;
		lines.push("## Coverage");
		lines.push("");
		lines.push("| Metric | Coverage |");
		lines.push("| --- | --- |");
		lines.push(`| Statements | ${pct(cov.totals.statements)} |`);
		lines.push(`| Branches | ${pct(cov.totals.branches)} |`);
		lines.push(`| Functions | ${pct(cov.totals.functions)} |`);
		lines.push(`| Lines | ${pct(cov.totals.lines)} |`);
		lines.push("");

		if (cov.lowCoverage.length > 0) {
			const thresholdParts: string[] = [];
			const g = cov.thresholds.global;
			if (g.lines !== undefined) thresholdParts.push(`lines: ${g.lines}%`);
			if (g.functions !== undefined) thresholdParts.push(`functions: ${g.functions}%`);
			if (g.branches !== undefined) thresholdParts.push(`branches: ${g.branches}%`);
			if (g.statements !== undefined) thresholdParts.push(`statements: ${g.statements}%`);
			const thresholdDisplay = thresholdParts.length > 0 ? thresholdParts.join(", ") : "configured thresholds";
			lines.push("> [!WARNING]");
			lines.push(`> ${cov.lowCoverage.length} file(s) below coverage threshold (${thresholdDisplay}):`);
			lines.push(">");
			for (const f of cov.lowCoverage) {
				const worst = worstCoverage(f);
				lines.push(`> - \`${f.file}\` — ${worst.label} ${pct(worst.pct)}`);
			}
			lines.push("");
		}
	}

	return lines;
}

// --- Main formatter ---

/**
 * Format one or more {@link (AgentReport:variable) | AgentReports} as a GitHub-Flavored
 * Markdown string for writing to `GITHUB_STEP_SUMMARY`.
 *
 * @remarks
 * GFM-specific features used in the output:
 *
 * - **Summary table** with pass/fail counts across all projects
 * - **Collapsible `<details>` blocks** for per-project results in monorepo setups
 * - **Tables** for coverage metrics
 * - **Diff-fenced code blocks** for expected/received comparison output
 * - **GitHub Alert callouts** (`[!WARNING]`) for coverage threshold violations
 *
 * For a single report, the project body is rendered directly without
 * a `<details>` wrapper. For multiple reports (monorepo), each project
 * gets its own collapsible section with a status icon in the summary line.
 *
 * @param reports - One or more agent reports to format
 * @returns GFM-formatted string ready for appending to `GITHUB_STEP_SUMMARY`
 *
 * @public
 */
export function formatGfm(reports: AgentReport[]): string {
	const lines: string[] = [];

	const anyFailures = reports.some((r) => r.summary.failed > 0);
	const headerIcon = anyFailures ? "❌" : "✅";
	lines.push(`# ${headerIcon} Vitest Results`);
	lines.push("");

	// Overall summary table
	const totalPassed = reports.reduce((acc, r) => acc + r.summary.passed, 0);
	const totalFailed = reports.reduce((acc, r) => acc + r.summary.failed, 0);
	const totalTests = reports.reduce((acc, r) => acc + r.summary.total, 0);

	lines.push("| | Count |");
	lines.push("| --- | --- |");
	lines.push(`| Passed | **${totalPassed}** |`);
	lines.push(`| Failed | **${totalFailed}** |`);
	lines.push(`| Total | **${totalTests}** |`);
	lines.push("");

	if (reports.length > 1) {
		// Multi-project: each in a <details> block
		for (const report of reports) {
			const projectLabel = report.project ?? "default";
			const statusIcon = report.summary.failed > 0 ? "❌" : "✅";
			lines.push(`<details>`);
			lines.push(`<summary>${statusIcon} ${projectLabel}</summary>`);
			lines.push("");
			const bodyLines = formatProjectBody(report);
			lines.push(...bodyLines);
			lines.push("</details>");
			lines.push("");
		}
	} else if (reports.length === 1) {
		// Single project: no wrapper
		const bodyLines = formatProjectBody(reports[0]);
		lines.push(...bodyLines);
	}

	return lines.join("\n");
}
