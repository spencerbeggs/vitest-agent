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
	ActionSeverity,
	CellOptions,
	FailureRecord,
	FileCoverageReport,
	GlobShortfall,
	ProjectSummary,
	RenderState,
	SuggestedActionRecord,
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
 * A kit document rendered at colour `none` (so no paint, whatever the
 * audience): one compact list item whose title line is never wrapped and
 * opens with the test file as a `Doc.link` (written through `link`, so a
 * human at a terminal with hyperlink support gets an OSC 8 link to the
 * file and everyone else the path alone), whose first message line is a
 * truncated `Doc.line`, and whose diff is `Doc.diffText` with `truncate`.
 * Each content line is cut to `width - 2` (floor 20) after the item indent.
 * The kit sanitizes the text, so a tab becomes a space and an escape
 * sequence is removed — which is why the link is a `Doc.link` the renderer
 * writes, never an escape pasted into the text.
 */
export const formatFailure = (
	f: FailureRecord,
	width: number,
	link: CellOptions["link"] = (_target, label) => label,
): ReadonlyArray<string> => {
	const suite = f.suitePath.length > 0 ? `${f.suitePath.join(" > ")} > ` : "";
	const classification = f.classification !== null ? ` [${f.classification}]` : "";
	const parts: Array<Block> = [
		Doc.line(
			[
				Doc.link({ file: f.modulePath }, f.modulePath, { suffix: false }),
				Doc.text(` > ${suite}${f.testName}${classification}`),
			],
			{ wrap: false },
		),
	];
	if (f.error?.message !== undefined) {
		parts.push(Doc.line(f.error.message.split("\n", 1)[0] ?? "", { truncate: true }));
	}
	if (f.error?.diff !== undefined) parts.push(Doc.diffText(f.error.diff, { truncate: true }));
	// `ansi` at colour `none` paints nothing and writes a link only through
	// `link`; `plain` never calls `link` at all, so it cannot carry one.
	return Render.ansi([Doc.list([Doc.section(undefined, parts)], { compact: true })], {
		...Render.contextOf({ audience: "human", width: Math.max(22, width) }),
		// The cell's writer takes file targets alone; a URL target never occurs here.
		link: (target, label) => ("file" in target ? link(target, label) : label),
	}).split("\n");
};

/**
 * The `Glob aggregates below threshold:` block — one
 * `- <pattern>: lines 60% < 90%, branches 55% < 80%` line per shortfall,
 * listing only the metrics that miss their minimum. Returns an empty array
 * when there are no shortfalls. Shared by the dispatcher cells and
 * `renderAgent` so both agent surfaces use one line format.
 */
export const formatGlobShortfallLines = (
	shortfalls: ReadonlyArray<GlobShortfall> | undefined,
): ReadonlyArray<string> => {
	if (shortfalls === undefined || shortfalls.length === 0) return [];
	const metricOrder = ["lines", "branches", "functions", "statements"] as const;
	const lines = ["Glob aggregates below threshold:"];
	for (const g of shortfalls) {
		const parts: string[] = [];
		for (const m of metricOrder) {
			const min = g.thresholds[m];
			const actual = g.summary[m];
			if (min !== undefined && actual < min) parts.push(`${m} ${formatPercent(actual)} < ${formatPercent(min)}`);
		}
		lines.push(`- ${g.pattern}: ${parts.join(", ")}`);
	}
	return lines;
};

/**
 * One coverage judgment line — `Coverage: ✓ all metrics meet thresholds`
 * for a clean run, `Coverage: ✗ <N> files below minimum thresholds (...)`
 * for a per-file violation, `Coverage: ✗ <N> glob aggregates below
 * threshold` when only glob aggregate shortfalls exist. Returns `null`
 * when the run carries no coverage block.
 */
export const formatCoverageJudgmentLine = (state: RenderState): string | null => {
	const cov = state.coverage;
	if (cov === null) return null;
	const shortfallCount = cov.globShortfalls?.length ?? 0;
	if (cov.violations.length === 0) {
		if (shortfallCount > 0) {
			return `Coverage: ${statusGlyph("failure")} ${Fmt.plural(shortfallCount, "glob aggregate")} below threshold`;
		}
		return `Coverage: ${statusGlyph("success")} all metrics meet thresholds`;
	}
	// A threshold violation is a `failure` (✗); only a target shortfall is a warning.
	const metrics = cov.violations.map((v) => v.metric).join(", ");
	const fileCount = countLowCoverageFiles(cov.gaps);
	return `Coverage: ${statusGlyph("failure")} ${Fmt.plural(fileCount, "file")} below minimum thresholds (${metrics})`;
};

/**
 * The coverage judgment line followed by the glob aggregate shortfall
 * block, as the lines a threshold cell appends to its summary. Empty when
 * the run carries no coverage block.
 */
export const formatCoverageSummaryLines = (state: RenderState): ReadonlyArray<string> => {
	const judgment = formatCoverageJudgmentLine(state);
	if (judgment === null) return [];
	return [judgment, ...formatGlobShortfallLines(state.coverage?.globShortfalls)];
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
 * The two cells of one project's row: the status glyph with the name, then
 * the counts, duration and (for a multi-tag project) the tag counts. The
 * glyph is `✓` for a clean project and `✗` for one carrying failures or
 * timeouts.
 */
const projectCells = (project: ProjectSummary): readonly [string, string] => {
	const timeoutCount = project.timeoutCount ?? 0;
	const total = project.passCount + project.failCount + project.skipCount + timeoutCount;
	const failing = project.failCount > 0 || timeoutCount > 0;
	const glyph = statusGlyph(failing ? "failure" : "success");
	const countParts = [`${project.passCount}/${total} passed`];
	if (project.failCount > 0) countParts.push(`${project.failCount} failed`);
	if (timeoutCount > 0) countParts.push(`${timeoutCount} timed out`);
	const counts = failing ? countParts.join(", ") : `${project.passCount} passed`;
	const tagSuffix = formatTagCountSuffix(project.tagCounts);
	const base = `${counts} (${formatDisplayDuration(project.durationMs)})`;
	return [`${glyph} ${project.name}`, tagSuffix.length === 0 ? base : `${base}  ${tagSuffix}`];
};

const formatTagCountSuffix = (tagCounts: Record<string, number> | undefined): string => {
	if (tagCounts === undefined) return "";
	const entries = Object.entries(tagCounts);
	if (entries.length <= 1) return "";
	const sorted = [...entries].sort(([a], [b]) => a.localeCompare(b));
	return sorted.map(([tag, count]) => `${tag}:${count}`).join("  ");
};

/**
 * A render width no table reaches, so the kit never truncates a cell: a
 * project name or a coverage path is printed whole however long it is
 * (issue #237 follow-up).
 */
const UNBOUNDED_WIDTH = Number.MAX_SAFE_INTEGER;

/**
 * Format the `Projects (N):` block as an array of lines including the
 * leading header and each project row, indented two spaces.
 *
 * @remarks
 * The rows are a header-less, space-aligned kit `Doc.table` rendered plain,
 * so the name column is padded by display width (a wide or combining
 * character in a project name keeps the counts aligned) rather than by
 * UTF-16 length.
 */
export const formatProjectsTable = (projects: ReadonlyArray<ProjectSummary>): ReadonlyArray<string> => {
	if (projects.length === 0) return [];
	const table = Doc.table([{ header: "" }, { header: "" }], projects.map(projectCells));
	const rows = Render.plain([table], Render.contextOf({ audience: "agent", width: UNBOUNDED_WIDTH }))
		.split("\n")
		.map((row) => `  ${row}`);
	return [`Projects (${projects.length}):`, ...rows];
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

/**
 * Format the `Files below aspirational target:` block — an istanbul-shaped
 * pipe table (`Doc.table` with `style: "pipe"`) of the first `limit` files,
 * followed by a `… N more` line when files were omitted. Returns an empty
 * array when `belowTarget` is empty.
 *
 * @remarks
 * The table renders at {@link UNBOUNDED_WIDTH}, so the kit never truncates a
 * cell and a printed path is always whole (issue #237 follow-up). Columns are
 * padded by display width and the percentage cells are centred by the kit.
 * Each path is a `Doc.link` written through `link`, so a hyperlink wraps the
 * path alone and never the padding. It renders through `Render.ansi` at
 * colour `none` (as {@link formatFailure} does), since `plain` never calls
 * `link`.
 */
export const formatBelowTargetTable = (
	belowTarget: ReadonlyArray<FileCoverageReport>,
	limit: number,
	link: CellOptions["link"] = (_target, label) => label,
): ReadonlyArray<string> => {
	if (belowTarget.length === 0) return [];
	const pct = (header: string) => ({ header, align: "center" as const });
	const table = Doc.table(
		[
			{ header: "File" },
			pct("% Stmts"),
			pct("% Branch"),
			pct("% Funcs"),
			pct("% Lines"),
			{ header: "Uncovered Line #s" },
		],
		belowTarget.map((file) => [
			Doc.link({ file: file.file }, file.file, { suffix: false }),
			pctCell(file.summary.statements),
			pctCell(file.summary.branches),
			pctCell(file.summary.functions),
			pctCell(file.summary.lines),
			file.uncoveredLines,
		]),
		{
			style: "pipe",
			cap: limit,
			overflow: (hidden) => `… ${hidden} more (use the test_coverage MCP tool for the full list)`,
		},
	);
	const rendered = Render.ansi([table], {
		...Render.contextOf({ audience: "human", width: UNBOUNDED_WIDTH }),
		// The cell's writer takes file targets alone; a URL target never occurs here.
		link: (target, label) => ("file" in target ? link(target, label) : label),
	});
	return ["Files below aspirational target:", ...rendered.split("\n")];
};

const pctCell = (n: number): string => `${Math.round(n)}`;

const SEVERITY_LABEL: Record<ActionSeverity, string> = {
	info: "info",
	warn: "warn",
	blocker: "blocker",
};

/**
 * The suggested-actions block as a compact list: `Actions:` then, per action,
 * `- <severity>: <title> (tool: <targetTool>)` with the detail indented under
 * it. Empty when there is nothing to suggest. Shared by `renderAgent` and the
 * dispatcher, so the one-shot and cell paths print the same list (issue #544).
 *
 * @public
 */
export const formatSuggestedActionLines = (actions: ReadonlyArray<SuggestedActionRecord>): ReadonlyArray<string> => {
	if (actions.length === 0) return [];
	const lines = ["Actions:"];
	for (const action of actions) {
		const tool = action.targetTool !== undefined ? ` (tool: ${action.targetTool})` : "";
		lines.push(`- ${SEVERITY_LABEL[action.severity]}: ${action.title}${tool}`, `  ${action.detail}`);
	}
	return lines;
};
