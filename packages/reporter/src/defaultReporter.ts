/**
 * The default reporter for the 2.0 plugin.
 *
 * Implements `VitestAgentReporterFactory` from the SDK. The plugin
 * imports this factory and wires it as its built-in when the user's
 * `reporter` option is unset. The factory is invoked at run start; its
 * `render` call assembles the reduced state, classifies the shape and
 * outcome, and dispatches to the matching cell, emitting one
 * RenderedOutput targeted at stdout.
 *
 * Branches on the resolved `consoleMode`:
 *
 * - `agent` → emits the dispatched agent-string for the whole run.
 * - `silent` / `passthrough` / `ci-annotations` → emits nothing; the
 *   visible work happens elsewhere.
 * - `stream` → emits nothing from `render`; the reporter owns a live view
 *   (the kit's `CliUi.live`, see `liveView.ts`) subscribed to the kit's
 *   run-event channel, which paints per event during the run and is closed
 *   through the reporter's `close` at Vitest's close.
 */

import type { CliTheme, CoreStatusName, Inline } from "@effected/cli";
import { Doc, Fmt, Render, Status } from "@effected/cli";
import type { TerminalEnv } from "@effected/env";
import type {
	AgentReport,
	DispatchInputs,
	FileCoverageReport,
	ProjectSummary,
	RenderState,
	RenderedOutput,
	ReporterKit,
	ReporterRenderInput,
	RunOutcome,
	RunReportFile,
	RunShape,
	SuggestedActionRecord,
	TestClassification,
	TrendSummary,
	VitestAgentReporter,
	VitestAgentReporterFactory,
} from "@vitest-agent/sdk";
import { RUN_REPORT_FILE_SCHEMA_URL, formatStrayOutputNote } from "@vitest-agent/sdk";
import type { SynthesizeFromAgentReportOptions } from "@vitest-agent/ui";
import {
	classifyOutcome,
	classifyRunShape,
	dispatch,
	formatSuggestedActionLines,
	reduceRenderStateAll,
	synthesizeFromAgentReport,
} from "@vitest-agent/ui";
import type { Layer } from "effect";
import { Effect } from "effect";
import { resolveFileLink } from "./fileLinks.js";
import { renderGithubLog, strayOutputOf, toDisplayPath } from "./githubLog.js";
import { LiveViewEnv, startLiveView } from "./liveView.js";
import { summarizeProject } from "./projectSummary.js";

const collectBelowTarget = (reports: ReadonlyArray<AgentReport>): ReadonlyArray<FileCoverageReport> => {
	const out: FileCoverageReport[] = [];
	for (const r of reports) {
		const list = r.coverage?.belowTarget;
		if (list !== undefined) out.push(...list);
	}
	return out;
};

const liftTrendSummary = (input: ReporterRenderInput): TrendSummary | null => {
	const trend = input.trendSummary;
	if (trend === undefined) return null;
	return {
		direction: trend.direction,
		runCount: trend.runCount,
		...(trend.firstMetric !== undefined ? { firstMetric: trend.firstMetric } : {}),
	};
};

/**
 * Build a `DispatchInputs` from a {@link ReporterRenderInput} and
 * the reduced `RenderState`.
 *
 * Exported so a custom reporter built on the same dispatcher can reuse
 * this assembly step without rebuilding it from scratch.
 *
 * @public
 */
export const buildDispatchInputs = (
	state: RenderState,
	input: ReporterRenderInput,
	overrides: { readonly shape?: RunShape; readonly outcome?: RunOutcome; readonly runCommand?: string | null } = {},
): DispatchInputs => {
	const projects = input.reports.map((r) => summarizeProject(r));
	const shape = overrides.shape ?? classifyRunShape(state, projects);
	const outcome = overrides.outcome ?? classifyOutcome(state);
	return {
		state,
		shape,
		outcome,
		projects,
		trend: liftTrendSummary(input),
		belowTarget: collectBelowTarget(input.reports),
		runCommand: overrides.runCommand ?? null,
	};
};

const shouldRenderForMode = (mode: ReporterKit["config"]["consoleMode"]): boolean => mode === "agent";

/**
 * Options for the one-shot report renderers.
 *
 * @public
 */
export interface ReportRenderOptions {
	/** Run-level suggested actions to append as the `Actions:` list (issue #544). */
	readonly suggestedActions?: ReadonlyArray<SuggestedActionRecord>;
}

/**
 * Options for the Ink one-shot renderer: the agent options plus a layout width.
 *
 * @public
 */
export interface HumanReportRenderOptions extends ReportRenderOptions {
	/** The column width to lay out at; the terminal's (else 80) when omitted. */
	readonly width?: number;
}

const synthesizeOptionsFrom = (options: ReportRenderOptions): SynthesizeFromAgentReportOptions => ({
	...(options.suggestedActions !== undefined ? { suggestedActions: options.suggestedActions } : {}),
});

/**
 * Convenience helper for one-shot consumers (e.g. a CLI command
 * replaying a stored run). Synthesizes a minimal `ReporterRenderInput`
 * from a single `AgentReport`, classifies the shape and outcome, and
 * returns the dispatched agent-string for the matching cell. Equivalent
 * to the pre-2.0 `renderRun(events, "agent")` shortcut. Pass
 * `options.suggestedActions` to append the run's `Actions:` list.
 *
 * @public
 */
export const renderAgentStringForReport = (report: AgentReport, options: ReportRenderOptions = {}): string => {
	const events = synthesizeFromAgentReport(report, synthesizeOptionsFrom(options));
	const state = reduceRenderStateAll(events);
	const projects: ReadonlyArray<ProjectSummary> = [summarizeProject(report)];
	const shape = classifyRunShape(state, projects);
	const outcome = classifyOutcome(state);
	const inputs: DispatchInputs = {
		state,
		shape,
		outcome,
		projects,
		trend: null,
		belowTarget: collectBelowTarget([report]),
		runCommand: null,
	};
	// An agent reads the string: no link writer, so no escape of any kind.
	return dispatch(inputs, {});
};

/**
 * Same as {@link renderAgentStringForReport} but returns the Ink-half
 * rendered to a string via Ink's `renderToString`, inside the kit's
 * `UiProvider` (the components draw the terminal's glyph set, ASCII under
 * `TERM=dumb`). ANSI escape sequences are preserved so a terminal renders
 * the colors live.
 * Returns the agent-string fallback when the matched cell has no Ink
 * half.
 *
 * The output is laid out at `options.width` when given, else at the
 * terminal's width (stdout's columns, else the `COLUMNS` variable), else at
 * 80 columns, which is what a non-TTY run gets. React and Ink are loaded on
 * the first call, never by importing this package.
 *
 * @public
 */
export const renderHumanStringForReport = (
	report: AgentReport,
	options: HumanReportRenderOptions = {},
): Promise<string> => renderHumanString(report, options, LiveViewEnv);

/**
 * {@link renderHumanStringForReport} over an explicit environment, which
 * decides the theme, the glyphs and the terminal width.
 *
 * @internal
 */
export const renderHumanString = async (
	report: AgentReport,
	options: HumanReportRenderOptions,
	env: Layer.Layer<CliTheme | TerminalEnv>,
): Promise<string> => {
	const events = synthesizeFromAgentReport(report, synthesizeOptionsFrom(options));
	const state = reduceRenderStateAll(events);
	const projects: ReadonlyArray<ProjectSummary> = [summarizeProject(report)];
	const shape = classifyRunShape(state, projects);
	const outcome = classifyOutcome(state);
	const inputs: DispatchInputs = {
		state,
		shape,
		outcome,
		projects,
		trend: null,
		belowTarget: collectBelowTarget([report]),
		runCommand: null,
	};
	// The second sanctioned lazy load (with `liveView.ts`'s view): the Ink
	// render module, so the agent path's import graph carries no React or Ink.
	// It resolves the link writer from `env` itself; the string fallback for a
	// cell with no Ink half gets the same writer.
	const { renderInkReport } = await import("./humanReport.js");
	const rendered = await renderInkReport(inputs, env, options.width);
	if (rendered !== null) return rendered;
	const link = await Effect.runPromise(resolveFileLink.pipe(Effect.provide(env)));
	return dispatch(inputs, { link });
};

const NON_STABLE_SUMMARY_CLASSIFICATIONS: ReadonlyArray<TestClassification> = [
	"new-failure",
	"persistent",
	"flaky",
	"recovered",
];

const MAX_SUMMARY_COVERAGE_ROWS = 10;
/** Sample lines shown in the step summary's stray-output section; the same cap the human note uses. */
const MAX_SUMMARY_STRAY_SAMPLES = 3;

/**
 * The step summary and `summary.md` are files, not log lines, so their
 * markdown context opts out of the `ci` default that neutralizes workflow
 * commands.
 */
const summaryRenderContext = Render.contextOf({
	audience: "ci",
	displayPath: toDisplayPath,
	neutralizeWorkflowCommands: false,
});

const renderClassificationsSection = (classifications: ReporterRenderInput["classifications"]): string | null => {
	const counts = new Map<TestClassification, number>();
	for (const classification of classifications.values()) {
		counts.set(classification, (counts.get(classification) ?? 0) + 1);
	}
	const rows = NON_STABLE_SUMMARY_CLASSIFICATIONS.filter((kind) => (counts.get(kind) ?? 0) > 0).map((kind) => [
		kind,
		String(counts.get(kind)),
	]);
	if (rows.length === 0) return null;
	return Render.markdown(
		[Doc.heading(3, "Classifications"), Doc.table([{ header: "Classification" }, { header: "Count" }], rows)],
		summaryRenderContext,
	);
};

const formatCoveragePercent = (totals: FileCoverageReport["summary"]): string =>
	`stmts ${totals.statements}%, branches ${totals.branches}%, funcs ${totals.functions}%, lines ${totals.lines}%`;

const renderCoverageSection = (reports: ReporterRenderInput["reports"]): string | null => {
	const belowTarget = reports.flatMap((r) => r.coverage?.belowTarget ?? []);
	if (belowTarget.length === 0) return null;
	// `Doc.file` shows the path through the context's `displayPath`, unlinked.
	const rows = belowTarget.map((f) => [Doc.file(f.file), formatCoveragePercent(f.summary)]);
	return Render.markdown(
		[
			Doc.heading(3, "Coverage"),
			Doc.paragraph(`${belowTarget.length} file(s) below target.`),
			Doc.table([{ header: "File" }, { header: "Coverage" }], rows, {
				cap: MAX_SUMMARY_COVERAGE_ROWS,
				overflow: (hidden) => `(+${hidden} more not shown)`,
			}),
		],
		summaryRenderContext,
	);
};

/**
 * The trend as one line per fact. `Doc.lines` joins them with GFM hard breaks
 * (a trailing `\\`), so a GFM reader cannot collapse them into one paragraph.
 */
const renderTrendSection = (trendSummary: ReporterRenderInput["trendSummary"]): string | null => {
	if (trendSummary === undefined) return null;
	const lines = [`Direction: ${trendSummary.direction}`, `Run count: ${trendSummary.runCount}`];
	const firstMetric = trendSummary.firstMetric;
	if (firstMetric !== undefined) {
		const targetSuffix = firstMetric.target !== undefined ? ` (target: ${firstMetric.target})` : "";
		lines.push(`${firstMetric.name}: ${firstMetric.from} → ${firstMetric.to}${targetSuffix}`);
	}
	return Render.markdown([Doc.heading(3, "Trend"), Doc.lines(lines)], summaryRenderContext);
};

/**
 * Split a plain-text note on its backtick spans into inlines, so a span the
 * shared formatter wrote as `` `x` `` renders as a code span in markdown
 * rather than as the sanitizer's escaped literal backticks. An unmatched
 * trailing backtick is kept as text.
 */
const inlineWithCodeSpans = (text: string): Array<Inline> => {
	const parts = text.split("`");
	const inlines: Array<Inline> = [];
	parts.forEach((part, index) => {
		if (part.length === 0) return;
		const insideSpan = index % 2 === 1 && index < parts.length - 1;
		inlines.push(insideSpan ? Doc.code(part) : Doc.text(part));
	});
	return inlines;
};

/**
 * What the run wrote straight to the terminal, past Vitest's console capture
 * (issue #578): the same headline the human and agent notes print, the byte
 * count, then the sample lines as code spans (a sample is untrusted text, so
 * it is never read as markdown). `null` when the run wrote nothing stray.
 */
const renderStrayOutputSection = (reports: ReporterRenderInput["reports"]): string | null => {
	const stray = strayOutputOf(reports);
	if (stray === undefined) return null;
	const [headline = ""] = formatStrayOutputNote(stray);
	const shown = stray.samples.slice(0, MAX_SUMMARY_STRAY_SAMPLES);
	const lines = shown.map((sample) => [Doc.text(`${sample.stream}: `), Doc.code(sample.text)]);
	const more = stray.total - shown.length;
	if (more > 0 && shown.length > 0) lines.push([Doc.text(`(+${more} more)`)]);
	return Render.markdown(
		[
			Doc.heading(3, "Stray output"),
			Doc.paragraph(...inlineWithCodeSpans(`${headline} ${Fmt.plural(stray.bytes, "byte")} recorded.`)),
			...(lines.length > 0 ? [Doc.lines(lines)] : []),
		],
		summaryRenderContext,
	);
};

/**
 * Per-project pass/fail/timeout/skip/duration table — the unconditional
 * half of the summary body.
 *
 * Vitest's own `github-actions` reporter no longer writes these counts
 * to the step summary (its job-summary half is disabled), so this table
 * is the only place a CI reader sees the totals. A multi-project run
 * gets a trailing `Total` row; a single-project run does not, because
 * the row would just repeat the one above it.
 *
 * Every count comes from `summarizeProject`, the same projection the
 * console surfaces render from — so the table cannot disagree with what
 * the terminal printed. That matters most for timeouts:
 * `summarizeProject` folds suite-level (collection/load) failures INTO
 * `failCount` and pulls timed-out tests back OUT of it, reporting them
 * in their own column. Recomputing from `report.summary.failed` here
 * would show a timed-out test as `Failed: 1` while every console surface
 * says `0 failed, 1 timed out`.
 *
 * A plain `Doc.table`, not `Doc.countsTable`: the counts table heads its
 * label column with nothing (this one reads `Project`) and has no column for
 * a formatted, non-count cell like the duration.
 *
 * @internal
 */
const renderTotalsSection = (reports: ReporterRenderInput["reports"]): string => {
	const rows = reports.map((report) => summarizeProject(report));
	const counter = (status: CoreStatusName, key: string, label: string, n: number) =>
		Doc.counter(Status.core, status, { key, label, n, showZero: true });
	const tableRows = rows.map((r) => ({
		label: r.name,
		counters: [
			counter("success", "passed", "Passed", r.passCount),
			counter("failure", "failed", "Failed", r.failCount),
			counter("warning", "timedOut", "Timed out", r.timeoutCount ?? 0),
			counter("skip", "skipped", "Skipped", r.skipCount),
		],
		durationMs: r.durationMs,
	}));
	const table = Doc.countsTable(tableRows, {
		labelHeader: "Project",
		durationHeader: "Duration",
		...(rows.length > 1 ? { totalRow: Doc.strong("Total") } : {}),
	});
	return Render.markdown([Doc.heading(3, "Totals"), table], summaryRenderContext);
};

/**
 * Assemble the vitest-agent markdown body shared by the GitHub step
 * summary and the `summary.md` report file: a `## vitest-agent` heading,
 * the always-present per-project totals table, then whichever of the
 * classification, coverage, trend, and stray-output sections have content.
 *
 * Always returns markdown. An all-green run still gets a body — with
 * Vitest's own job summary disabled, returning `null` here left the step
 * summary blank on every passing CI run and wrote no `summary.md` at
 * all.
 *
 * @internal
 */
const buildSummaryMarkdown = (input: ReporterRenderInput): string => {
	const sections = [
		renderClassificationsSection(input.classifications),
		renderCoverageSection(input.reports),
		renderTrendSection(input.trendSummary),
		renderStrayOutputSection(input.reports),
	].filter((section): section is string => section !== null);
	return ["## vitest-agent", renderTotalsSection(input.reports), ...sections].join("\n\n");
};

/**
 * Builds the vitest-agent GitHub step-summary payload — ONE `RenderedOutput`
 * for the whole run: the per-project totals table, plus test
 * classifications (new-failure / persistent / flaky / recovered),
 * coverage-target shortfalls, and the coverage trend when those have
 * content.
 *
 * The totals used to be omitted on the theory that Vitest's own
 * `github-actions` reporter already wrote pass/fail/skip counts to the
 * same `$GITHUB_STEP_SUMMARY` file. That is no longer true — its
 * job-summary half is disabled — so this block is the only summary a CI
 * reader gets, and it is always emitted. A green run gets a totals table
 * rather than nothing at all.
 */
const renderGithubSummary = (input: ReporterRenderInput): ReadonlyArray<RenderedOutput> => {
	const body = buildSummaryMarkdown(input);
	// Bracketed in newlines: `routeRenderedOutput` APPENDS to
	// GITHUB_STEP_SUMMARY, and Vitest's own `github-actions` reporter has
	// usually already written its `## Vitest Test Report` block there. The
	// leading newline keeps our heading off the tail of its last list item;
	// the trailing one keeps whatever appends next off ours.
	return [{ target: "github-summary", content: `\n${body}\n`, contentType: "text/markdown" }];
};

/**
 * The default reporter factory.
 *
 * The plugin uses this as its built-in when no user `reporter` option
 * is supplied, and a custom-reporter author reads it as the canonical
 * worked example of the `VitestAgentReporterFactory` contract.
 *
 * The factory is invoked once at run start with the run-start kit. In
 * `consoleMode: "stream"` it starts a live view on the kit's run-event
 * channel (subscribed before the factory returns, so the first
 * `RunStarted` is seen) and owns it for the reporter's life: the
 * reporter's `close`, which the plugin calls at Vitest's close before
 * shutting the channel down, drains the queued events, waits for the last
 * frame and closes it.
 *
 * The `render` call (invoked once at run end with the health-aware kit)
 * assembles the reduced state, classifies the shape and outcome, and
 * dispatches to the matching cell. Output is one stdout entry carrying
 * the cell's string. When `kit.config.githubActions` is true a GFM
 * step-summary payload is appended for routing to GITHUB_STEP_SUMMARY.
 * In `stream` mode `render` emits nothing — the live mount painted the run.
 *
 * @public
 */
export const DefaultVitestAgentReporter: VitestAgentReporterFactory = (kit: ReporterKit): VitestAgentReporter => {
	const live =
		kit.config.consoleMode === "stream" && kit.runEvents !== undefined ? startLiveView(kit.runEvents) : undefined;
	// Stream mode prints the run's `Actions:` block once, after the live view
	// has closed: the Ink frame commits at the terminal event and never moves,
	// so findings are collected here and shown at the end (issue #544).
	let actionLines: ReadonlyArray<string> = [];
	let actionsPrinted = false;
	const closeLive =
		live !== undefined
			? async (): Promise<void> => {
					try {
						await live.close();
					} catch (error) {
						// close never rejects by contract; report it and still print the Actions block.
						process.stderr.write(`vitest-agent: the live view failed to close: ${String(error)}\n`);
					}
					if (actionsPrinted || actionLines.length === 0) return;
					actionsPrinted = true;
					process.stdout.write(`\n${actionLines.join("\n")}\n`);
				}
			: undefined;
	return {
		...(live !== undefined && closeLive !== undefined ? { close: closeLive, printStrayLine: live.printStrayLine } : {}),
		render(input: ReporterRenderInput, renderKit: ReporterKit): ReadonlyArray<RenderedOutput> {
			const out: RenderedOutput[] = [];
			if (live !== undefined) actionLines = formatSuggestedActionLines(input.suggestedActions ?? []);
			if (shouldRenderForMode(renderKit.config.consoleMode)) {
				// The suggested actions ride every report's stream so a single-
				// or multi-project fold ends with them in `RenderState` (issue #544).
				const events = input.reports.flatMap((r) =>
					synthesizeFromAgentReport(r, {
						...(input.suggestedActions !== undefined ? { suggestedActions: input.suggestedActions } : {}),
					}),
				);
				const state = reduceRenderStateAll(events);
				const inputs = buildDispatchInputs(state, input, {
					runCommand: renderKit.config.runCommand ?? null,
				});
				// `agent` is the only console mode that renders here, and an agent
				// never gets a link: no writer.
				const content = dispatch(inputs, {});
				if (content.length > 0) {
					out.push({ target: "stdout", content, contentType: "text/plain" });
				}
			}
			if (renderKit.config.githubActions === true) {
				out.push(...renderGithubSummary(input));
				out.push(renderGithubLog(input, renderKit));
			}
			// Report files: written by the plugin into `.vitest/<scope>/` when
			// reporting is enabled, and dropped by the router when it is not.
			// Emitted regardless of console mode — they are the machine-facing
			// artifact, independent of what the terminal shows.
			out.push({
				target: "report",
				filename: "run.json",
				contentType: "application/json",
				content: `${JSON.stringify(
					{
						$schema: RUN_REPORT_FILE_SCHEMA_URL,
						schemaVersion: 1 as const,
						generatedAt: new Date().toISOString(),
						reports: input.reports,
						...(input.runDiagnostics !== undefined ? { runDiagnostics: input.runDiagnostics } : {}),
					} satisfies RunReportFile,
					null,
					2,
				)}\n`,
			});
			out.push({
				target: "report",
				filename: "summary.md",
				contentType: "text/markdown",
				content: `${buildSummaryMarkdown(input)}\n`,
			});
			return out;
		},
	};
};
