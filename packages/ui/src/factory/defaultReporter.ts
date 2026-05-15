/**
 * The preassembled default reporter for the 2.0 plugin.
 *
 * Implements `VitestAgentReporterFactory` from the SDK. The plugin
 * imports this factory and wires it as its built-in when the user's
 * `reporter` option is unset. Subscribes to the run-event stream the
 * plugin emits, folds events through the reducer, runs the shape ×
 * outcome dispatcher, and emits one RenderedOutput targeted at stdout.
 *
 * Branches on the resolved `consoleMode`:
 *
 * - `agent` → emits the dispatched agent-string for the whole run.
 * - `silent` / `passthrough` / `ci-annotations` → emits nothing; the
 *   visible work happens elsewhere.
 * - `ink` → emits nothing here; the plugin's live Ink mount paints
 *   per-event during the run.
 *
 * @packageDocumentation
 */

import type {
	AgentReport,
	CellOptions,
	DispatchInputs,
	FileCoverageReport,
	ProjectSummary,
	RenderState,
	RenderedOutput,
	ReporterKit,
	ReporterRenderInput,
	RunOutcome,
	RunShape,
	TrendSummary,
	VitestAgentReporter,
	VitestAgentReporterFactory,
} from "vitest-agent-sdk";
import { classifyOutcome, classifyRunShape } from "../dispatcher/classify.js";
import { dispatch, dispatcherTable } from "../dispatcher/dispatch.js";
import { reduceRenderStateAll } from "../reducer.js";
import { synthesizeFromAgentReport } from "../synthesize.js";

const summarizeProject = (report: AgentReport): ProjectSummary => {
	const collapsedTagCounts = report.tagCounts !== undefined ? collapseTagCounts(report.tagCounts) : undefined;
	const tagCountsHasEntries = collapsedTagCounts !== undefined && Object.keys(collapsedTagCounts).length > 0;
	const belowTargetCount = report.coverage?.belowTargetFiles?.length;
	const violationsCount =
		report.coverage !== undefined && report.coverage.lowCoverage.length > 0
			? report.coverage.lowCoverage.length
			: undefined;
	return {
		name: report.project ?? "default",
		passCount: report.summary.passed,
		failCount: report.summary.failed,
		skipCount: report.summary.skipped,
		durationMs: report.summary.duration,
		...(tagCountsHasEntries && collapsedTagCounts !== undefined ? { tagCounts: collapsedTagCounts } : {}),
		...(belowTargetCount !== undefined ? { belowTarget: belowTargetCount } : {}),
		...(violationsCount !== undefined ? { violations: violationsCount } : {}),
	};
};

const collapseTagCounts = (entries: AgentReport["tagCounts"]): Record<string, number> => {
	const out: Record<string, number> = {};
	if (entries === undefined) return out;
	for (const [tag, entry] of Object.entries(entries)) {
		const total = (entry.passed ?? 0) + (entry.failed ?? 0) + (entry.skipped ?? 0);
		if (total > 0) out[tag] = total;
	}
	return out;
};

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
 * Build a {@link DispatchInputs} from a {@link ReporterRenderInput} and
 * the reduced {@link RenderState}.
 *
 * Exported so a custom reporter built on the same dispatcher can reuse
 * this assembly step without rebuilding it from scratch.
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

/**
 * Build {@link CellOptions} from a {@link ReporterKit}. Picks the kit's
 * resolved `noColor` value and the pre-bound OSC-8 hyperlink helper.
 */
export const resolveCellOptions = (kit: ReporterKit): CellOptions => ({
	noColor: kit.config.noColor,
	osc8: kit.stdOsc8,
});

const shouldRenderForMode = (mode: ReporterKit["config"]["consoleMode"]): boolean => mode === "agent";

/**
 * Convenience helper for one-shot consumers (e.g. the CLI `show`
 * command replaying a stored run). Synthesizes a minimal
 * `ReporterRenderInput` from a single `AgentReport`, classifies the
 * shape and outcome, and returns the dispatched agent-string for the
 * matching cell. Equivalent to the pre-2.0 `renderRun(events, "agent")`
 * shortcut.
 */
export const renderAgentStringForReport = (report: AgentReport): string => {
	const events = synthesizeFromAgentReport(report);
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
	return dispatch(inputs, { noColor: true, osc8: (_url, label) => label });
};

/**
 * Same as {@link renderAgentStringForReport} but returns the Ink-half
 * rendered to a string via Ink's `renderToString`. ANSI escape
 * sequences are preserved so a terminal renders the colors live.
 * Returns the agent-string fallback when the matched cell has no Ink
 * half.
 */
export const renderHumanStringForReport = async (
	report: AgentReport,
	options: { readonly width?: number } = {},
): Promise<string> => {
	const { renderToString } = await import("ink");
	const events = synthesizeFromAgentReport(report);
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
	const opts: CellOptions = { noColor: false, osc8: (_url, label) => label };
	const cell = dispatcherTable[inputs.shape][inputs.outcome];
	if (cell.ink === undefined) {
		return dispatch(inputs, opts);
	}
	return renderToString(cell.ink(inputs, opts), { columns: options.width ?? 80 });
};

const renderGithubSummary = (input: ReporterRenderInput): ReadonlyArray<RenderedOutput> => {
	// GitHub step summary: one GFM payload per project report. Each entry
	// is appended to the GITHUB_STEP_SUMMARY file by the plugin's
	// route-rendered-output dispatcher. The body uses the existing
	// markdown formatter from the SDK so the layout matches the pre-2.0
	// step-summary output.
	const out: RenderedOutput[] = [];
	for (const report of input.reports) {
		const heading = `## ${report.project ?? "Vitest Results"}`;
		const stats = `${report.summary.passed}/${report.summary.total} passed, ${report.summary.failed} failed, ${report.summary.skipped} skipped`;
		const body = `${heading}\n\n${stats}\n`;
		out.push({ target: "github-summary", content: body, contentType: "text/markdown" });
	}
	return out;
};

/**
 * The preassembled default reporter factory.
 *
 * The plugin uses this as its built-in when no user `reporter` option
 * is supplied. The render call assembles the reduced state, classifies
 * the shape and outcome, and dispatches to the matching cell. Output
 * is one stdout entry carrying the cell's string. When
 * `kit.config.githubActions` is true a GFM step-summary payload is
 * appended for routing to GITHUB_STEP_SUMMARY.
 */
export const _defaultReporter: VitestAgentReporterFactory = (kit: ReporterKit): VitestAgentReporter => ({
	render(input: ReporterRenderInput): ReadonlyArray<RenderedOutput> {
		const out: RenderedOutput[] = [];
		if (shouldRenderForMode(kit.config.consoleMode)) {
			const events = input.reports.flatMap((r) => synthesizeFromAgentReport(r));
			const state = reduceRenderStateAll(events);
			const inputs = buildDispatchInputs(state, input, {
				runCommand: kit.config.runCommand ?? null,
			});
			const opts = resolveCellOptions(kit);
			const content = dispatch(inputs, opts);
			if (content.length > 0) {
				out.push({ target: "stdout", content, contentType: "text/plain" });
			}
		}
		if (kit.config.githubActions === true) {
			out.push(...renderGithubSummary(input));
		}
		return out;
	},
});
