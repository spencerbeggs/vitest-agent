import { Schema } from "effect";
import { AgentConsoleMode, CiConsoleMode, HumanConsoleMode } from "./Common.js";
import { CoverageTargets } from "./CoverageTargets.js";
import { Transport } from "./Transport.js";

/**
 * Per-executor console-output matrix. Most users never set this — the
 * built-in defaults cover the common cases. Override per slot when you
 * want to force a specific layout for debugging or to suppress one
 * channel without affecting the others.
 *
 * Defaults:
 * - `human` → `"passthrough"` today; users opt into `"stream"` explicitly
 *   for the progressively-drawn, animated agent-shaped live renderer.
 * - `agent` → `"agent"` (markdown-flavored final frame).
 * - `ci` → `"passthrough"` (Vitest's reporters produce log-friendly
 *   output). `"ci-annotations"` is opt-in until the dedicated GHA
 *   annotations writer ships.
 * @public
 */
export const ConsoleOutputs = Schema.Struct({
	human: Schema.optional(HumanConsoleMode),
	agent: Schema.optional(AgentConsoleMode),
	ci: Schema.optional(CiConsoleMode),
}).annotate({ identifier: "ConsoleOutputs" });
/** @public */
export type ConsoleOutputs = typeof ConsoleOutputs.Type;

/**
 * Report-file settings. An object overrides the scope directory name
 * used under `.vitest/`; the default scope is `vitest-agent`.
 *
 * @public
 */
export const ReportSettings = Schema.Struct({
	scope: Schema.optional(
		Schema.String.check(
			Schema.makeFilter((scope) =>
				scope.includes("/") || scope.includes("\\") || scope === ".." || scope === "."
					? `report.scope ${scope} must be a single directory name — it is resolved directly under .vitest/ and cannot nest or escape.`
					: undefined,
			),
		),
	),
}).annotate({ identifier: "ReportSettings" });
/** @public */
export type ReportSettings = typeof ReportSettings.Type;

/**
 * Report-file settings. `false` disables `.vitest/<scope>/` writes
 * entirely; an object overrides the scope directory name.
 *
 * Default: on for the `agent` and `ci` executors, off for `human`.
 * @public
 */
export const ReportOption = Schema.Union([Schema.Literal(false), ReportSettings]).annotate({
	identifier: "ReportOption",
});
/** @public */
export type ReportOption = typeof ReportOption.Type;

/**
 * The 2.0 user-facing options for `AgentPlugin`.
 *
 * Seven fields total. Two are function-typed (`reporter`, `onRunEvent`)
 * and live on the `AgentPluginConstructorOptions` companion interface in
 * `@vitest-agent/plugin` — Effect Schema cannot encode functions cleanly,
 * so the schema-decodable struct carries the five data-shaped fields.
 * @public
 */
export const AgentPluginOptions = Schema.Struct({
	console: Schema.optional(ConsoleOutputs),
	coverageTargets: Schema.optional(CoverageTargets),
	transport: Schema.optional(Transport),
	report: Schema.optional(ReportOption),
	/**
	 * Whether a run is recorded in the SQLite `data.db` (default `true`).
	 *
	 * `false` is the explicit opt-out for a runner where nothing reads the
	 * database back — a throwaway CI job, say. The run still renders every
	 * console and report-file output, still emits every `RunEvent`, and
	 * Vitest still enforces `coverage.thresholds` through its own
	 * mechanism; only the database writes are skipped: run rows, test
	 * cases, failure history, coverage rows and trends, and the baselines
	 * they feed. Consequences a renderer sees: failure classifications are
	 * empty (there is no history to classify against, so no test is
	 * labelled `stable`, `new-failure`, `persistent`, `flaky` or
	 * `recovered`), and coverage renders without a baseline delta or a
	 * trend line. The `data.db` file is never created or opened.
	 *
	 * The opt-out is never automatic: `CI=true` does not imply it, because
	 * some CI setups cache `data.db` between jobs and query it. The
	 * `VITEST_AGENT_PERSIST` environment variable (`0` / `false` / `off`
	 * to disable, `1` / `true` / `on` to enable) is the operator spelling
	 * for a runner whose config cannot be edited, and it wins over this
	 * option in either direction; any other value is ignored with one
	 * stderr line.
	 *
	 * `coverage.enabled: false` in Vitest's own config already skips
	 * persistence (UI-only mode, Decision 38) — this option is for a run
	 * that keeps coverage on and still wants no database.
	 */
	persist: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "AgentPluginOptions" });
/** @public */
export type AgentPluginOptions = typeof AgentPluginOptions.Type;

/**
 * Reporter-implementation options.
 *
 * Public for users building custom reporters via `@vitest-agent/reporter`;
 * most users never see this type — they wire `AgentPlugin({ reporter })`
 * and the factory receives a fully-resolved `ReporterKit` instead.
 *
 * Carries internal flags the plugin sets when constructing the reporter
 * (currently only `projectFilter` for per-project scoping).
 * @public
 */
export const AgentReporterOptions = Schema.Struct({
	/** Set by the plugin per-project. Filters reports to one project. */
	projectFilter: Schema.optional(Schema.String),
}).annotate({ identifier: "AgentReporterOptions" });
/** @public */
export type AgentReporterOptions = typeof AgentReporterOptions.Type;
