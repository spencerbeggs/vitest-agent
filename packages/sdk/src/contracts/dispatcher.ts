import type { FileCoverageReport } from "../schemas/Coverage.js";
import type { RenderState } from "../schemas/RenderState.js";

/**
 * The four run shapes the dispatcher distinguishes.
 *
 * Computed once per run from the reduced state's module count, the
 * distinct-project count (carried via {@link DispatchInputs.projects}),
 * and the test count inside each module.
 *
 * - `single-test`    — exactly one test by name across the run.
 * - `single-file`    — exactly one module, more than one test.
 * - `single-project` — one project, more than one module.
 * - `workspace`      — more than one project.
 * @public
 */
export type RunShape = "single-test" | "single-file" | "single-project" | "workspace";

/**
 * The three outcome classes the dispatcher distinguishes.
 *
 * - `all-pass`             — `totals.failed === 0` and no coverage threshold violations.
 * - `some-fail`            — `totals.failed > 0`.
 * - `threshold-violation`  — `totals.failed === 0` and at least one coverage violation.
 * @public
 */
export type RunOutcome = "all-pass" | "some-fail" | "threshold-violation";

/**
 * Compact per-project aggregate carried into workspace cells.
 *
 * Populated by the plugin from `ReporterRenderInput.reports`. Empty for
 * non-workspace shapes. `tagCounts`, `belowTarget`, and `violations` are
 * optional — workspace cells render the columns only when present.
 * @public
 */
export interface ProjectSummary {
	readonly name: string;
	readonly passCount: number;
	readonly failCount: number;
	readonly skipCount: number;
	readonly durationMs: number;
	readonly tagCounts?: Record<string, number>;
	readonly belowTarget?: number;
	readonly violations?: number;
}

/**
 * Per-run trend direction handed to cells that surface a `Trend: …` line.
 *
 * Mirrors the inline `ReporterRenderInput.trendSummary` shape — promoted
 * to a named type here so the dispatcher and its cells can pass it around
 * without re-declaring it. The plugin populates this from
 * `ReporterRenderInput.trendSummary` before invoking `dispatch`.
 * @public
 */
export interface TrendSummary {
	readonly direction: "improving" | "regressing" | "stable";
	readonly runCount: number;
	readonly firstMetric?: {
		readonly name: string;
		readonly from: number;
		readonly to: number;
		readonly target?: number;
	};
}

/**
 * Inputs each cell renderer reads to produce its output.
 *
 * `state` carries the post-reduce projection of the `RunEvent`
 * stream. `shape` and `outcome` are the classified axes the dispatcher
 * keyed on to reach this cell. The remaining fields are non-state
 * helpers the plugin computes once before dispatch so cells stay pure.
 * @public
 */
export interface DispatchInputs {
	readonly state: RenderState;
	readonly shape: RunShape;
	readonly outcome: RunOutcome;
	/**
	 * Per-project aggregates carried into workspace cells. Populated by
	 * the plugin from `ReporterRenderInput.reports`; empty for non-workspace
	 * shapes.
	 */
	readonly projects: ReadonlyArray<ProjectSummary>;
	/**
	 * Trend direction for cells that surface a `Trend: …` line. `null`
	 * for scoped runs and any run where trend history is unavailable.
	 */
	readonly trend: TrendSummary | null;
	/**
	 * Files below the aspirational `coverageTargets` tier. Workspace and
	 * project cells surface a truncated listing of these; single-file and
	 * single-test cells ignore them.
	 */
	readonly belowTarget: ReadonlyArray<FileCoverageReport>;
	/**
	 * Configured run command (e.g. `pnpm test`). Cell footers reference
	 * this so copy-pasted commands stay accurate. `null` when no command
	 * was configured.
	 */
	readonly runCommand: string | null;
}

/**
 * Render-time options threaded into each cell from the resolved
 * `ReporterKit`. These are concerns the cell needs to format its
 * output but that do not belong on the state-derived
 * {@link DispatchInputs} struct.
 *
 * The plugin builds this once per run from the kit and passes it into
 * `dispatch(inputs, opts)`. Cells destructure only what they consume.
 * @public
 */
export interface CellOptions {
	/**
	 * Resolved value of the `NO_COLOR` env var. Cells gate ANSI escape
	 * sequences and OSC-8 hyperlinks on this.
	 */
	readonly noColor: boolean;
	/**
	 * Pre-bound OSC-8 hyperlink helper. The plugin has already decided
	 * whether OSC-8 should be enabled (`target=stdout`, `!noColor`) so
	 * cells can call this directly without re-consulting the environment.
	 */
	readonly osc8: (url: string, label: string) => string;
}
