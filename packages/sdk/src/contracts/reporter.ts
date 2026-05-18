/**
 * Public reporter contract for the vitest-agent plugin.
 *
 * The plugin owns persistence, classification, baselines, trends, and the
 * Vitest lifecycle wiring. The reporter is just the rendering stage: it
 * receives an assembled run (reports + classifications + trend context),
 * gets a kit of plugin-resolved primitives (env detection, OSC-8 helper,
 * resolved config), and returns `RenderedOutput[]` to be routed.
 *
 * A reporter is richer than a single Formatter — it can dispatch to multiple
 * formatters internally (e.g. a `GitHubReporter` emits SARIF for code
 * scanning AND markdown for the step summary). The return shape is
 * `RenderedOutput[]` so a single render call can produce multiple targets
 * with different content types.
 *
 * @packageDocumentation
 */

import type { PubSub } from "effect";
import type { RenderedOutput } from "../formatters/types.js";
import type { AgentReport } from "../schemas/AgentReport.js";
import type {
	ConsoleMode,
	DetailLevel,
	Environment,
	Executor,
	OutputFormat,
	TestClassification,
} from "../schemas/Common.js";
import type { RunEvent } from "../schemas/RunEvent.js";
import type { ResolvedThresholds } from "../schemas/Thresholds.js";
import type { Transport } from "../schemas/Transport.js";

/**
 * Config the plugin computes from its own options + Vitest's resolved config,
 * then hands to the reporter factory inside {@link ReporterKit}.
 *
 * `dbPath` is optional at the type level so renderers that don't care about
 * the persistence layer (e.g. a stdout-only renderer) can ignore it. The
 * plugin always populates it in practice — the option exists for clarity
 * and to leave room for future "no-persistence" experiments.
 *
 * `format` and `detail` are pre-resolved by the plugin (via
 * `FormatSelector` / `DetailResolver`) but reporters that want to override
 * can ignore them. `noColor` is the resolved value of the `NO_COLOR` env
 * var; reporters use it to gate ANSI escapes and OSC-8 hyperlinks.
 */
export interface ResolvedReporterConfig {
	readonly dbPath?: string;
	readonly projectFilter?: string;
	/**
	 * The executor the plugin detected at run time (`human`, `agent`, `ci`).
	 * Renderers branch on this when their per-mode behavior depends on the
	 * observer (e.g. honoring `NO_COLOR` only when a human is watching).
	 */
	readonly executor: Executor;
	/**
	 * The {@link ConsoleMode} value the plugin selected for the active
	 * executor — the result of looking up `console.{executor}` and falling
	 * back to the per-slot default. Renderers that need to know "what am I
	 * supposed to produce right now?" read this single field.
	 */
	readonly consoleMode: ConsoleMode;
	readonly mcp: boolean;
	readonly consoleOutput: "failures" | "full" | "silent";
	readonly omitPassingTests: boolean;
	readonly coverageConsoleLimit: number;
	readonly includeBareZero: boolean;
	readonly githubActions: boolean;
	readonly githubSummary: boolean;
	readonly githubSummaryFile?: string;
	readonly coverageThresholds?: ResolvedThresholds;
	readonly coverageTargets?: ResolvedThresholds;
	/**
	 * Operating mode resolved from Vitest's native `coverage.enabled` config.
	 * - `"full"` — coverage is enabled; all analytics and persistence run.
	 * - `"ui-only"` — coverage is disabled (`coverage.enabled: false`); reporter
	 *   renders output but the persistence pipeline is skipped (Phase 5).
	 *
	 * The plugin always resolves this field in `configureVitest`.
	 * @internal
	 */
	readonly coverageMode: "full" | "ui-only";
	readonly format: OutputFormat;
	readonly detail: DetailLevel;
	readonly noColor: boolean;
	readonly runCommand?: string;
	/**
	 * Transport binding for the persistence layer. Custom reporters
	 * read this when they want to branch on backend kind (e.g. behave
	 * differently against a cloud DB). 2.x ships only `{ kind: "local" }`.
	 */
	readonly transport?: Transport;
	/**
	 * Snapshot of Vitest's `test.passWithNoTests` policy captured from
	 * the resolved config at `configureVitest` time.
	 *
	 * Informational for consumer reporters that want to render the
	 * resolved policy alongside other run context. The MCP `run_tests`
	 * tool does not read this field — when its per-call
	 * `passWithNoTests` override is unset the tool forwards nothing to
	 * `createVitest`, and Vitest re-resolves from the project config on
	 * disk. The `no-match` discriminator is filter-driven and is not
	 * affected by this policy.
	 *
	 * Optional because the field is only present when populated by the
	 * plugin; consumers constructing `ResolvedReporterConfig` directly
	 * may omit it.
	 */
	readonly passWithNoTests?: boolean;
}

/**
 * Plugin-provided primitives passed to the reporter factory at construction
 * time. The `std*` prefix marks these as "the plugin gives you these — do
 * not import equivalents yourself"; they are pre-resolved with full context
 * (environment, executor, NO_COLOR, target=stdout) so the reporter doesn't
 * have to re-derive that state.
 *
 * The shape is open to additions: future fields (e.g. `stdLogger`,
 * `stdRuntime`) won't break existing reporters because the parameter is a
 * named-field object. Reporters destructure only what they consume.
 */
export interface ReporterKit {
	readonly config: ResolvedReporterConfig;
	readonly stdEnv: Environment;
	/**
	 * Pre-bound OSC-8 hyperlink helper. The plugin has already decided
	 * whether OSC-8 should be enabled (target=stdout, !noColor) so the
	 * reporter can call this directly without consulting environment.
	 */
	readonly stdOsc8: (url: string, label: string) => string;
	/**
	 * Live run-event channel. The plugin publishes one {@link RunEvent}
	 * per Vitest streaming callback (`onTestRunStart`, `onTestModuleStart`,
	 * `onTestCaseResult`, `onTestRunEnd`, …) onto this `PubSub` as the run
	 * progresses. A reporter that paints live — the default reporter's Ink
	 * mount in `consoleMode: "ink"` — subscribes here at construction time
	 * (the factory is invoked at run start, before the first event) and
	 * drives its renderer off the stream.
	 *
	 * Optional at the type level so a reporter constructed directly
	 * without the plugin (tests, one-shot replay) can omit it; a reporter
	 * that wants live events must guard for `undefined`. The plugin always
	 * populates it.
	 */
	readonly runEvents?: PubSub.PubSub<RunEvent>;
}

/**
 * Per-run data handed to {@link VitestAgentReporter.render} after the plugin
 * has finished persisting and classifying the run.
 *
 * `reports` is one entry per project (multi-project Vitest configs produce
 * multiple). `classifications` is keyed by `TestReport.fullName` and is the
 * stable / new-failure / persistent / flaky / recovered label assigned by
 * `HistoryTracker`. `trendSummary` is present only on full (non-scoped) runs
 * where coverage trends were computed.
 */
export interface ReporterRenderInput {
	readonly reports: ReadonlyArray<AgentReport>;
	readonly classifications: ReadonlyMap<string, TestClassification>;
	readonly trendSummary?: {
		readonly direction: "improving" | "regressing" | "stable";
		readonly runCount: number;
		readonly firstMetric?: {
			readonly name: string;
			readonly from: number;
			readonly to: number;
			readonly target?: number;
		};
	};
}

/**
 * The reporter contract. Implement this to plug a custom output strategy
 * into `vitest-agent`.
 *
 * `render` is called once per test run after the plugin has persisted all
 * data. It receives the assembled run plus a second, health-aware
 * {@link ReporterKit}: the kit handed to the factory is resolved at run
 * start (before failures are known), while the kit handed to `render` is
 * resolved at run end and reflects post-run `detail`. A reporter that does
 * construction-time work reads the factory kit; a reporter that renders
 * reads the `render` kit. The reporter returns `RenderedOutput[]` — the
 * plugin routes each entry to its declared `target` (`stdout`, `file`,
 * `github-summary`), so the reporter does not need to know about file
 * paths or write streams.
 *
 * A "no-op" reporter is one line: `() => ({ render: () => [] })`. Useful
 * for users who only want persistence (the MCP/CLI tools see the data) and
 * no console output at all.
 */
export interface VitestAgentReporter {
	readonly render: (input: ReporterRenderInput, kit: ReporterKit) => ReadonlyArray<RenderedOutput>;
}

/**
 * Factory that the plugin's `reporter` option accepts. The plugin calls
 * this once with the resolved kit; the factory returns either a single
 * reporter or an array of reporters bound to that kit.
 *
 * Returning an array models Vitest's own multi-reporter pattern
 * (`reporters: ['default', 'github-actions']`): each reporter handles
 * its own concern (e.g. one for stdout markdown, one for SARIF, one
 * for the GitHub Actions step summary) and the plugin concatenates
 * their `RenderedOutput[]` before routing. Persistence still runs
 * exactly once — the plugin owns the Vitest lifecycle and the
 * reporters never see Vitest events directly.
 *
 * Defaulting to a factory (rather than passing a class or pre-made
 * instance) gives implementations a place to do construction-time work
 * (e.g. opening a file handle, capturing config) while still letting
 * the plugin own the kit assembly.
 */
export type VitestAgentReporterFactory = (kit: ReporterKit) => VitestAgentReporter | ReadonlyArray<VitestAgentReporter>;
