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
 * Six fields total. Two are function-typed (`reporter`, `onRunEvent`)
 * and live on the `AgentPluginConstructorOptions` companion interface in
 * `@vitest-agent/plugin` — Effect Schema cannot encode functions cleanly,
 * so the schema-decodable struct carries the four data-shaped fields.
 * @public
 */
export const AgentPluginOptions = Schema.Struct({
	console: Schema.optional(ConsoleOutputs),
	coverageTargets: Schema.optional(CoverageTargets),
	transport: Schema.optional(Transport),
	report: Schema.optional(ReportOption),
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
