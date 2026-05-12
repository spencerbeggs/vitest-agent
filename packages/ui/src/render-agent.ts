/**
 * Agent-mode renderer: produces a token-efficient final-frame string
 * from a fully-reduced {@link RenderState}.
 *
 * Output is intentionally separate from the Ink renderer — agents
 * benefit from a different layout than humans (no ANSI, no live
 * progress, no decoration overhead). The output is stable for stable
 * inputs: no timestamps, no derived "time ago" phrasing, no randomized
 * ordering.
 *
 * @packageDocumentation
 */

import type { ActionSeverity, FailureRecord, ModuleRecord, RenderState, SuggestedActionRecord } from "vitest-agent-sdk";

/**
 * Options controlling agent-mode output. All fields optional; defaults
 * match the spec's "80-column, top-3 gaps, no error stack" target.
 */
export interface RenderAgentOptions {
	/**
	 * Target column width for soft-wrapping the longer detail lines.
	 * The renderer does not enforce a hard wrap — short lines never
	 * pad — but uses this when truncating diff or stack output.
	 *
	 * @defaultValue 80
	 */
	readonly width?: number;
	/**
	 * How many coverage gaps to list (top by missing lines). Set to 0
	 * to omit the gap block entirely; the violations block is
	 * independent and always rendered when present.
	 *
	 * @defaultValue 3
	 */
	readonly maxCoverageGaps?: number;
	/**
	 * Whether to include the full stack trace for each failure. The
	 * agent path defaults to false because the structured failure data
	 * is already available via MCP tools.
	 *
	 * @defaultValue false
	 */
	readonly includeStack?: boolean;
}

const DEFAULT_WIDTH = 80;
const DEFAULT_MAX_GAPS = 3;

const severityLabel: Record<ActionSeverity, string> = {
	info: "info",
	warn: "warn",
	blocker: "blocker",
};

const formatDurationMs = (ms: number): string => `${ms}ms`;

const formatHeader = (state: RenderState): string => {
	const { passCount, failCount, skipCount, durationMs } = state.totals;
	const total = passCount + failCount + skipCount;
	const parts = [`${passCount}/${total} passed`];
	if (failCount > 0) parts.push(`${failCount} failed`);
	if (skipCount > 0) parts.push(`${skipCount} skipped`);
	return `Tests: ${parts.join(", ")} (${formatDurationMs(durationMs)})`;
};

const formatModulesSection = (state: RenderState): string | null => {
	const modules = state.moduleOrder
		.map((path) => state.modules[path])
		.filter((m): m is ModuleRecord => m !== undefined);

	if (modules.length === 0) return null;

	const interestingModules = modules.filter((m) => m.failCount > 0 || m.skipCount > 0);

	if (interestingModules.length === 0) {
		const noun = modules.length === 1 ? "module" : "modules";
		return `${modules.length} ${noun} all-passed.`;
	}

	const lines = ["Modules:"];
	for (const m of modules) {
		const parts: string[] = [];
		if (m.passCount > 0) parts.push(`${m.passCount} passed`);
		if (m.failCount > 0) parts.push(`${m.failCount} failed`);
		if (m.skipCount > 0) parts.push(`${m.skipCount} skipped`);
		const summary = parts.length > 0 ? parts.join(", ") : `status=${m.status}`;
		lines.push(`- ${m.modulePath}: ${summary}`);
	}
	return lines.join("\n");
};

const truncate = (line: string, max: number): string => {
	if (line.length <= max) return line;
	const slice = max - 1;
	if (slice <= 0) return "…";
	return `${line.slice(0, slice)}…`;
};

const formatFailure = (f: FailureRecord, width: number, includeStack: boolean): string => {
	const suite = f.suitePath.length > 0 ? `${f.suitePath.join(" > ")} > ` : "";
	const classification = f.classification !== null ? ` [${f.classification}]` : "";
	const header = `- ${f.modulePath} > ${suite}${f.testName}${classification}`;
	const lines: string[] = [header];
	if (f.error?.message !== undefined) {
		const firstLine = f.error.message.split("\n", 1)[0] ?? "";
		lines.push(`  ${truncate(firstLine, Math.max(20, width - 2))}`);
	}
	if (f.error?.diff !== undefined) {
		for (const diffLine of f.error.diff.split("\n")) {
			lines.push(`  ${truncate(diffLine, Math.max(20, width - 2))}`);
		}
	}
	if (includeStack && f.error?.stack !== undefined) {
		for (const stackLine of f.error.stack.split("\n")) {
			lines.push(`  ${truncate(stackLine, Math.max(20, width - 2))}`);
		}
	}
	return lines.join("\n");
};

const formatFailuresSection = (state: RenderState, width: number, includeStack: boolean): string | null => {
	if (state.failures.length === 0) return null;
	const lines = ["Failures:"];
	for (const f of state.failures) {
		lines.push(formatFailure(f, width, includeStack));
	}
	return lines.join("\n");
};

const formatPercent = (n: number): string => {
	const rounded = Math.round(n * 10) / 10;
	return Number.isInteger(rounded) ? `${rounded}%` : `${rounded}%`;
};

const formatCoverageSection = (state: RenderState, maxGaps: number): string | null => {
	const cov = state.coverage;
	if (cov === null) return null;

	const lines = ["Coverage:"];
	const metricOrder = ["lines", "branches", "functions", "statements"] as const;
	for (const m of metricOrder) {
		const actual = cov.metrics[m];
		const threshold = cov.thresholds[m];
		const thresholdNote = threshold !== undefined ? ` (threshold ${formatPercent(threshold)})` : "";
		lines.push(`- ${m}: ${formatPercent(actual)}${thresholdNote}`);
	}

	if (cov.violations.length > 0) {
		lines.push("Violations:");
		for (const v of cov.violations) {
			lines.push(`- ${v.metric}: ${formatPercent(v.actual)} < ${formatPercent(v.expected)}`);
		}
	}

	if (maxGaps > 0 && cov.gaps.length > 0) {
		const sorted = [...cov.gaps].sort((a, b) => b.missing.lines - a.missing.lines);
		const topN = sorted.slice(0, maxGaps);
		lines.push("Gaps:");
		for (const g of topN) {
			const detail = g.uncoveredLines !== undefined ? `: ${g.uncoveredLines}` : "";
			lines.push(`- ${g.file}${detail}`);
		}
		const omitted = cov.gaps.length - topN.length;
		if (omitted > 0) {
			const noun = omitted === 1 ? "gap" : "gaps";
			lines.push(`- (+${omitted} more ${noun})`);
		}
	}

	return lines.join("\n");
};

const formatActionsSection = (state: RenderState): string | null => {
	if (state.suggestedActions.length === 0) return null;
	const lines = ["Actions:"];
	for (const a of state.suggestedActions) {
		lines.push(formatAction(a));
	}
	return lines.join("\n");
};

const formatAction = (a: SuggestedActionRecord): string => {
	const tool = a.targetTool !== undefined ? ` (tool: ${a.targetTool})` : "";
	return `- ${severityLabel[a.severity]}: ${a.title}${tool}\n  ${a.detail}`;
};

/**
 * Project the reduced {@link RenderState} into a single string suitable
 * for emission once at the end of a run.
 *
 * The output is deterministic given a stable input — folding the same
 * event sequence twice and rendering produces byte-identical strings.
 */
export const renderAgent = (state: RenderState, options: RenderAgentOptions = {}): string => {
	const width = options.width ?? DEFAULT_WIDTH;
	const maxGaps = options.maxCoverageGaps ?? DEFAULT_MAX_GAPS;
	const includeStack = options.includeStack ?? false;

	const sections: string[] = [formatHeader(state)];
	const failures = formatFailuresSection(state, width, includeStack);
	if (failures !== null) sections.push(failures);
	const modules = formatModulesSection(state);
	if (modules !== null) sections.push(modules);
	const coverage = formatCoverageSection(state, maxGaps);
	if (coverage !== null) sections.push(coverage);
	const actions = formatActionsSection(state);
	if (actions !== null) sections.push(actions);

	return `${sections.join("\n\n")}\n`;
};
