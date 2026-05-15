/**
 * Shared formatting helpers used across dispatcher cells.
 *
 * The cells are pure functions of `(inputs, opts)`; the helpers in this
 * file extract the common formatting concerns — duration rendering,
 * test totals, failure detail blocks, coverage line, projects table —
 * so each cell stays focused on layout decisions for its specific
 * shape × outcome pair.
 *
 * @packageDocumentation
 */

import type {
	FailureRecord,
	FileCoverageReport,
	ProjectSummary,
	RenderState,
	TestRecord,
	TrendSummary,
} from "vitest-agent-sdk";

const SECOND_MS = 1000;

/**
 * Format a duration in milliseconds. Uses `<N>ms` below one second
 * and `<N.N>s` at or above, matching the pre-2.0 console convention.
 */
export const formatDuration = (ms: number): string => {
	if (ms < SECOND_MS) return `${ms}ms`;
	const seconds = ms / SECOND_MS;
	const rounded = Math.round(seconds * 10) / 10;
	return `${rounded}s`;
};

/**
 * Format a coverage percentage. Uses one decimal place for non-integer
 * values, no decimal for integers, with a trailing percent sign.
 */
export const formatPercent = (n: number): string => {
	const rounded = Math.round(n * 10) / 10;
	return `${rounded}%`;
};

/**
 * Truncate a line to a maximum width with an ellipsis suffix.
 */
export const truncate = (line: string, max: number): string => {
	if (line.length <= max) return line;
	const slice = max - 1;
	if (slice <= 0) return "…";
	return `${line.slice(0, slice)}…`;
};

/**
 * Format the `Tests:` header line — `<pass>/<total> passed[, <fail> failed][, <skip> skipped] (Xms)`.
 */
export const formatTotals = (state: RenderState): string => {
	const { passCount, failCount, skipCount, durationMs } = state.totals;
	const total = passCount + failCount + skipCount;
	const parts = [`${passCount}/${total} passed`];
	if (failCount > 0) parts.push(`${failCount} failed`);
	if (skipCount > 0) parts.push(`${skipCount} skipped`);
	return `Tests: ${parts.join(", ")} (${formatDuration(durationMs)})`;
};

/**
 * Locate the sole {@link TestRecord} in a `single-test` shape state.
 * Returns `undefined` for malformed inputs; cells fall through to an
 * empty rendering rather than throwing.
 */
export const soleTest = (state: RenderState): TestRecord | undefined => {
	const moduleEntries = Object.values(state.modules);
	if (moduleEntries.length !== 1) return undefined;
	const sole = moduleEntries[0];
	if (!sole || sole.tests.length !== 1) return undefined;
	return sole.tests[0];
};

/**
 * Locate the sole module path in a `single-file` shape state.
 */
export const soleModulePath = (state: RenderState): string | undefined => {
	if (state.moduleOrder.length !== 1) return undefined;
	return state.moduleOrder[0];
};

/**
 * Format a test name in `<suite > test name>` form, or just `<test name>`
 * when no suite path is present.
 */
export const formatTestName = (test: {
	readonly testName: string;
	readonly suitePath: ReadonlyArray<string>;
}): string => {
	if (test.suitePath.length === 0) return test.testName;
	return `${test.suitePath.join(" > ")} > ${test.testName}`;
};

/**
 * Render one failure block — `- <path > suite > name> [classification]`
 * followed by the indented message and diff. Stack traces are omitted
 * by default to keep the agent string compact.
 */
export const formatFailure = (f: FailureRecord, width: number): ReadonlyArray<string> => {
	const suite = f.suitePath.length > 0 ? `${f.suitePath.join(" > ")} > ` : "";
	const classification = f.classification !== null ? ` [${f.classification}]` : "";
	const lines: string[] = [`- ${f.modulePath} > ${suite}${f.testName}${classification}`];
	if (f.error?.message !== undefined) {
		const firstLine = f.error.message.split("\n", 1)[0] ?? "";
		lines.push(`  ${truncate(firstLine, Math.max(20, width - 2))}`);
	}
	if (f.error?.diff !== undefined) {
		for (const diffLine of f.error.diff.split("\n")) {
			lines.push(`  ${truncate(diffLine, Math.max(20, width - 2))}`);
		}
	}
	return lines;
};

/**
 * One coverage judgment line — `Coverage: ✓ all metrics meet thresholds`
 * for a clean run, `Coverage: ✗ <N> files below minimum thresholds (...)`
 * for a violation. Returns `null` when the run carries no coverage block.
 */
export const formatCoverageJudgmentLine = (state: RenderState): string | null => {
	const cov = state.coverage;
	if (cov === null) return null;
	if (cov.violations.length === 0) {
		return "Coverage: ✓ all metrics meet thresholds";
	}
	const metrics = cov.violations.map((v) => v.metric).join(", ");
	const fileCount = countLowCoverageFiles(cov.gaps);
	const fileNoun = fileCount === 1 ? "file" : "files";
	return `Coverage: ✗ ${fileCount} ${fileNoun} below minimum thresholds (${metrics})`;
};

const countLowCoverageFiles = (gaps: ReadonlyArray<{ readonly file: string }>): number => {
	const seen = new Set<string>();
	for (const g of gaps) seen.add(g.file);
	return seen.size;
};

/**
 * Format the `Trend: …` line for runs that carry trend history.
 * Returns `null` when no trend is available.
 */
export const formatTrendLine = (trend: TrendSummary | null): string | null => {
	if (trend === null) return null;
	const runs = trend.runCount === 1 ? "1 run" : `${trend.runCount} runs`;
	return `Trend: ${trend.direction} (${runs})`;
};

/**
 * Format a compact projects-table line for one project. Pads the name
 * column to `nameWidth` so a column of rows aligns when joined with
 * newlines. Status glyph is `✓` for clean projects, `✗` for any
 * project carrying failures or violations.
 */
export const formatProjectRow = (project: ProjectSummary, nameWidth: number): string => {
	const total = project.passCount + project.failCount + project.skipCount;
	const glyph = project.failCount > 0 ? "✗" : "✓";
	const counts =
		project.failCount > 0
			? `${project.passCount}/${total} passed, ${project.failCount} failed`
			: `${project.passCount} passed`;
	const tagSuffix = formatTagCountSuffix(project.tagCounts);
	const paddedName = project.name.padEnd(nameWidth);
	const duration = formatDuration(project.durationMs);
	const base = `  ${glyph} ${paddedName} ${counts} (${duration})`;
	return tagSuffix.length === 0 ? base : `${base}  ${tagSuffix}`;
};

const formatTagCountSuffix = (tagCounts: Record<string, number> | undefined): string => {
	if (tagCounts === undefined) return "";
	const entries = Object.entries(tagCounts);
	if (entries.length <= 1) return "";
	const sorted = [...entries].sort(([a], [b]) => a.localeCompare(b));
	return sorted.map(([tag, count]) => `${tag}:${count}`).join("  ");
};

/**
 * Format the `Projects (N):` block as an array of lines including the
 * leading header and each project row. The longest project name sets
 * the padded column width so the counts align vertically.
 */
export const formatProjectsTable = (projects: ReadonlyArray<ProjectSummary>): ReadonlyArray<string> => {
	if (projects.length === 0) return [];
	const nameWidth = projects.reduce((max, p) => Math.max(max, p.name.length), 0);
	const header = `Projects (${projects.length}):`;
	const rows = projects.map((p) => formatProjectRow(p, nameWidth));
	return [header, ...rows];
};

/**
 * Format the `Total:` footer for a workspace run.
 */
export const formatWorkspaceTotal = (projects: ReadonlyArray<ProjectSummary>): string => {
	let pass = 0;
	let fail = 0;
	let skip = 0;
	let durationMs = 0;
	for (const p of projects) {
		pass += p.passCount;
		fail += p.failCount;
		skip += p.skipCount;
		durationMs += p.durationMs;
	}
	const total = pass + fail + skip;
	const parts = [`${pass}/${total} passed`];
	if (fail > 0) parts.push(`${fail} failed`);
	if (skip > 0) parts.push(`${skip} skipped`);
	return `Total: ${parts.join(", ")} (${formatDuration(durationMs)})`;
};

const TABLE_COL_FILE = 60;

/**
 * Format the `Files below aspirational target:` block — a pipe-delimited
 * table truncated to the first `limit` files with a "+N more" suffix.
 * Returns an empty array when `belowTarget` is empty.
 */
export const formatBelowTargetTable = (
	belowTarget: ReadonlyArray<FileCoverageReport>,
	limit: number,
): ReadonlyArray<string> => {
	if (belowTarget.length === 0) return [];
	const top = belowTarget.slice(0, limit);
	const omitted = belowTarget.length - top.length;
	const header = ["Files below aspirational target:", buildTableSeparator(), buildTableHeader(), buildTableSeparator()];
	const rows = top.map((file) => buildTableRow(file));
	const footer: string[] = [];
	if (omitted > 0) {
		footer.push(`… ${omitted} more (use the test_coverage MCP tool for the full list)`);
	}
	return [...header, ...rows, ...footer];
};

const buildTableSeparator = (): string => {
	return `${"-".repeat(TABLE_COL_FILE)}|---------|---------|---------|---------|-------------------`;
};

const buildTableHeader = (): string => {
	return ` ${"File".padEnd(TABLE_COL_FILE - 1)}| % Stmts | % Branch| % Funcs | % Lines | Uncovered Line #s`;
};

const buildTableRow = (file: FileCoverageReport): string => {
	const namePart = truncate(file.file, TABLE_COL_FILE - 2);
	const padded = ` ${namePart.padEnd(TABLE_COL_FILE - 1)}`;
	const stmts = pctCell(file.summary.statements);
	const branch = pctCell(file.summary.branches);
	const funcs = pctCell(file.summary.functions);
	const lines = pctCell(file.summary.lines);
	const uncovered = ` ${file.uncoveredLines}`;
	return `${padded}|${stmts}|${branch}|${funcs}|${lines}|${uncovered}`;
};

const pctCell = (n: number): string => {
	const rounded = Math.round(n);
	const text = `${rounded}`;
	const pad = Math.max(0, 9 - text.length);
	const left = Math.floor(pad / 2);
	const right = pad - left;
	return `${" ".repeat(left + 1)}${text}${" ".repeat(right)}`;
};
