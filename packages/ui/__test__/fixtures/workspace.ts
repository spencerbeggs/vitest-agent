/**
 * Workspace-shape fixtures for the dispatcher matrix tests.
 *
 * The workspace cells (`workspace × all-pass`, `× some-fail`,
 * `× threshold-violation`) read a `ProjectSummary[]` directly off
 * `DispatchInputs.projects` rather than deriving it from the event
 * stream. The plugin builds `ProjectSummary` per-project from each
 * `AgentReport`; we mirror that shape here.
 */

import type { FileCoverageReport, ProjectSummary, TrendSummary } from "@vitest-agent/sdk";

/**
 * Five-project workspace, all passing. Modeled on the
 * agent-output-format-restoration.md target output: small projects
 * with tag-count breakdowns on the mcp and sdk projects.
 */
export const workspacePassProjects: ReadonlyArray<ProjectSummary> = [
	{ name: "playground", passCount: 42, failCount: 0, skipCount: 0, durationMs: 31 },
	{ name: "vitest-agent-cli", passCount: 80, failCount: 0, skipCount: 0, durationMs: 12_300 },
	{ name: "vitest-agent-plugin", passCount: 194, failCount: 0, skipCount: 0, durationMs: 3_200 },
	{
		name: "vitest-agent-mcp",
		passCount: 182,
		failCount: 0,
		skipCount: 0,
		durationMs: 647,
		tagCounts: { int: 5, unit: 177 },
	},
	{
		name: "vitest-agent-sdk",
		passCount: 855,
		failCount: 0,
		skipCount: 0,
		durationMs: 5_400,
		tagCounts: { int: 6, unit: 849 },
	},
];

/**
 * Workspace with one project failing; other four pass.
 */
export const workspaceFailProjects: ReadonlyArray<ProjectSummary> = [
	{ name: "playground", passCount: 42, failCount: 0, skipCount: 0, durationMs: 31 },
	{ name: "vitest-agent-cli", passCount: 80, failCount: 0, skipCount: 0, durationMs: 12_300 },
	{
		name: "vitest-agent-plugin",
		passCount: 192,
		failCount: 2,
		skipCount: 0,
		durationMs: 3_400,
	},
	{
		name: "vitest-agent-mcp",
		passCount: 182,
		failCount: 0,
		skipCount: 0,
		durationMs: 647,
		tagCounts: { int: 5, unit: 177 },
	},
	{
		name: "vitest-agent-sdk",
		passCount: 855,
		failCount: 0,
		skipCount: 0,
		durationMs: 5_400,
		tagCounts: { int: 6, unit: 849 },
	},
];

/**
 * Workspace where everything passes but coverage policy is violated.
 */
export const workspaceThresholdProjects: ReadonlyArray<ProjectSummary> = workspacePassProjects;

/**
 * Trend summary used by workspace-pass and workspace-threshold
 * snapshot fixtures.
 */
export const regressingTrend: TrendSummary = {
	direction: "regressing",
	runCount: 48,
};

/**
 * Files below aspirational target — used by the threshold-violation
 * workspace cell to populate the truncated coverage table.
 */
export const belowTargetFixture: ReadonlyArray<FileCoverageReport> = [
	{
		file: "packages/reporter/src/default.ts",
		summary: { statements: 74, branches: 53, functions: 100, lines: 69 },
		uncoveredLines: "34,36,41,48-49",
	},
	{
		file: "packages/mcp/src/tools/errors.ts",
		summary: { statements: 79, branches: 65, functions: 67, lines: 78 },
		uncoveredLines: "139-145,195,197-199",
	},
	{
		file: "packages/plugin/src/configure.ts",
		summary: { statements: 81, branches: 70, functions: 80, lines: 80 },
		uncoveredLines: "12-15,22",
	},
	{
		file: "packages/cli/src/commands/db.ts",
		summary: { statements: 83, branches: 75, functions: 85, lines: 82 },
		uncoveredLines: "44-48",
	},
	{
		file: "packages/sdk/src/services/RunContext.ts",
		summary: { statements: 85, branches: 78, functions: 90, lines: 84 },
		uncoveredLines: "30,55-58",
	},
	{
		file: "packages/ui/src/render-agent.ts",
		summary: { statements: 88, branches: 82, functions: 92, lines: 87 },
		uncoveredLines: "61-64",
	},
	{
		file: "packages/sdk/src/utils/match-vitest-command.ts",
		summary: { statements: 90, branches: 85, functions: 95, lines: 89 },
		uncoveredLines: "100-103",
	},
];

/**
 * Single coverage violation record used by single-project /
 * single-file threshold-violation tests. Mirrors the
 * `singleProjectThresholdEvents` payload but threaded as a plain
 * fixture for direct DispatchInputs construction.
 */
export const singleProjectBelowTarget: ReadonlyArray<FileCoverageReport> = [
	{
		file: "src/parser/edge-cases.ts",
		summary: { statements: 70, branches: 60, functions: 100, lines: 70 },
		uncoveredLines: "12-18, 22, 30-35",
	},
];
