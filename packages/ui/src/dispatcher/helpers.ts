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

import type { Block } from "@effected/cli";
import { Doc, Fmt, Render } from "@effected/cli";
import type {
	FailureRecord,
	FileCoverageReport,
	ProjectSummary,
	RenderState,
	TestRecord,
	TrendSummary,
} from "@vitest-agent/sdk";
import { formatTotalsLine } from "../counts.js";
import { formatDisplayDuration } from "../format-duration.js";
import { statusGlyph } from "../theme.js";

export { formatDisplayDuration } from "../format-duration.js";

/**
 * Format a coverage percentage given on istanbul's 0–100 scale. One
 * decimal place for non-integer values, none for integers, with a
 * trailing percent sign (`Fmt.percent` with `scale: 100`).
 */
export const formatPercent = (n: number): string => Fmt.percent(n, { scale: 100 });

/**
 * Truncate a line to a maximum display width with an ellipsis suffix
 * (`Fmt.truncate`: grapheme- and East-Asian-width-aware).
 */
export const truncate = (line: string, max: number): string => Fmt.truncate(line, max);

/**
 * Format the `Tests:` header line —
 * `<pass>/<total> passed[, <fail> failed][, <timeout> timed out][, <skip> skipped] (Xms)`.
 * `total` folds in `timeoutCount` — a timed-out test is a real collected
 * test, not a pass (issue #224).
 */
export const formatTotals = (state: RenderState): string => {
	const modules = state.collectedModules;
	return formatTotalsLine({
		label: "Tests",
		...state.totals,
		...(modules !== undefined && modules > 0 ? { suffix: `across ${modules} files` } : {}),
	});
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
	if (sole?.tests.length !== 1) return undefined;
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
 *
 * @remarks
 * A kit document rendered plain for the agent audience: one compact list
 * item whose title is verbatim (never wrapped), whose first message line is
 * a truncated `Doc.line`, and whose diff is `Doc.diffText` with `truncate`.
 * Each content line is cut to `width - 2` (floor 20) after the item indent.
 * The kit sanitizes the text, so a tab becomes a space and an escape
 * sequence is removed.
 */
export const formatFailure = (f: FailureRecord, width: number): ReadonlyArray<string> => {
	const suite = f.suitePath.length > 0 ? `${f.suitePath.join(" > ")} > ` : "";
	const classification = f.classification !== null ? ` [${f.classification}]` : "";
	const parts: Array<Block> = [Doc.verbatim(`${f.modulePath} > ${suite}${f.testName}${classification}`)];
	if (f.error?.message !== undefined) {
		parts.push(Doc.line(f.error.message.split("\n", 1)[0] ?? "", { truncate: true }));
	}
	if (f.error?.diff !== undefined) parts.push(Doc.diffText(f.error.diff, { truncate: true }));
	return Render.plain(
		[Doc.list([Doc.section(undefined, parts)], { compact: true })],
		Render.contextOf({ audience: "agent", width: Math.max(22, width) }),
	).split("\n");
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
		return `Coverage: ${statusGlyph("success")} all metrics meet thresholds`;
	}
	// A threshold violation is a `failure` (✗); only a target shortfall is a warning.
	const metrics = cov.violations.map((v) => v.metric).join(", ");
	const fileCount = countLowCoverageFiles(cov.gaps);
	return `Coverage: ${statusGlyph("failure")} ${Fmt.plural(fileCount, "file")} below minimum thresholds (${metrics})`;
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
	return `Trend: ${trend.direction} (${Fmt.plural(trend.runCount, "run")})`;
};

/**
 * Format a compact projects-table line for one project. Pads the name
 * column to `nameWidth` so a column of rows aligns when joined with
 * newlines. Status glyph is `✓` for clean projects, `✗` for any
 * project carrying failures or violations.
 */
export const formatProjectRow = (project: ProjectSummary, nameWidth: number): string => {
	const timeoutCount = project.timeoutCount ?? 0;
	const total = project.passCount + project.failCount + project.skipCount + timeoutCount;
	const glyph = statusGlyph(project.failCount > 0 || timeoutCount > 0 ? "failure" : "success");
	const countParts = [`${project.passCount}/${total} passed`];
	if (project.failCount > 0) countParts.push(`${project.failCount} failed`);
	if (timeoutCount > 0) countParts.push(`${timeoutCount} timed out`);
	const counts = project.failCount > 0 || timeoutCount > 0 ? countParts.join(", ") : `${project.passCount} passed`;
	const tagSuffix = formatTagCountSuffix(project.tagCounts);
	const paddedName = project.name.padEnd(nameWidth);
	const duration = formatDisplayDuration(project.durationMs);
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
export const formatWorkspaceTotal = (projects: ReadonlyArray<ProjectSummary>): string =>
	formatTotalsLine({
		label: "Total",
		passCount: sumOf(projects, (p) => p.passCount),
		failCount: sumOf(projects, (p) => p.failCount),
		timeoutCount: sumOf(projects, (p) => p.timeoutCount ?? 0),
		skipCount: sumOf(projects, (p) => p.skipCount),
		durationMs: sumOf(projects, (p) => p.durationMs),
	});

const sumOf = (projects: ReadonlyArray<ProjectSummary>, pick: (p: ProjectSummary) => number): number =>
	projects.reduce((sum, p) => sum + pick(p), 0);

const TABLE_COL_FILE_MIN = 60;

/**
 * Format the `Files below aspirational target:` block — a pipe-delimited
 * table truncated to the first `limit` files with a "+N more" suffix.
 * Returns an empty array when `belowTarget` is empty.
 *
 * The file column is sized to the longest path among the printed rows
 * (never narrower than {@link TABLE_COL_FILE_MIN}), so a printed path is
 * never truncated (issue #237 follow-up) — only the omitted rows (past
 * `limit`) are unaffected, since their width never entered the
 * calculation.
 */
export const formatBelowTargetTable = (
	belowTarget: ReadonlyArray<FileCoverageReport>,
	limit: number,
): ReadonlyArray<string> => {
	if (belowTarget.length === 0) return [];
	const top = belowTarget.slice(0, limit);
	const omitted = belowTarget.length - top.length;
	const fileColWidth = Math.max(TABLE_COL_FILE_MIN, ...top.map((f) => f.file.length + 2));
	const header = [
		"Files below aspirational target:",
		buildTableSeparator(fileColWidth),
		buildTableHeader(fileColWidth),
		buildTableSeparator(fileColWidth),
	];
	const rows = top.map((file) => buildTableRow(file, fileColWidth));
	const footer: string[] = [];
	if (omitted > 0) {
		footer.push(`… ${omitted} more (use the test_coverage MCP tool for the full list)`);
	}
	return [...header, ...rows, ...footer];
};

const buildTableSeparator = (fileColWidth: number): string => {
	return `${"-".repeat(fileColWidth)}|---------|---------|---------|---------|-------------------`;
};

const buildTableHeader = (fileColWidth: number): string => {
	return ` ${"File".padEnd(fileColWidth - 1)}| % Stmts | % Branch| % Funcs | % Lines | Uncovered Line #s`;
};

const buildTableRow = (file: FileCoverageReport, fileColWidth: number): string => {
	const padded = ` ${file.file.padEnd(fileColWidth - 1)}`;
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
