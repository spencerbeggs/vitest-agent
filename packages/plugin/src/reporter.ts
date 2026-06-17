/**
 * @vitest-agent/plugin
 *
 * {@link AgentReporter} class implementing the Vitest Reporter interface.
 * Produces structured markdown to console, persistent data to SQLite,
 * and optional GFM output for GitHub Actions check runs.
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { NodeContext } from "@effect/platform-node";
import { DefaultVitestAgentReporter } from "@vitest-agent/reporter";
import type {
	AgentReport,
	AgentReporterOptions,
	ConsoleMode,
	CoverageBaselines,
	OutputFormat,
	ReporterKit,
	ResolvedThresholds,
	RunEvent,
	TestClassification,
	TestErrorInput,
	TestOutcome,
	Transport,
	VitestAgentReporter,
	VitestAgentReporterFactory,
	VitestTestModule,
} from "@vitest-agent/sdk";
import {
	DataReader,
	DataStore,
	DetailResolver,
	EnvironmentDetector,
	ExecutorResolver,
	FormatSelector,
	HistoryTracker,
	OutputPipelineLive,
	PathResolutionLive,
	buildAgentReport,
	computeTrend,
	ensureMigrated,
	formatFatalError,
	isTimeoutError,
	probeHostMetadataFromEnv,
	resolveDataPath,
	resolveLogFile,
	resolveLogLevel,
} from "@vitest-agent/sdk";
import type { LogLevel } from "effect";
import { Effect, Option, PubSub } from "effect";
import { ReporterLive } from "./layers/ReporterLive.js";
import { CoverageAnalyzer } from "./services/CoverageAnalyzer.js";
import { buildReporterKit, normalizeReporters } from "./utils/build-reporter-kit.js";
import { captureEnvVars } from "./utils/capture-env.js";
import { captureSettings, hashSettings } from "./utils/capture-settings.js";
import { processFailure } from "./utils/process-failure.js";
import { resolveThresholds } from "./utils/resolve-thresholds.js";
import { routeRenderedOutput } from "./utils/route-rendered-output.js";
import { stringifyFailureValue } from "./utils/stringify-failure-value.js";

/**
 * Cache of in-flight `resolveDataPath` promises, keyed by `projectDir`.
 *
 * Multi-project Vitest configs construct one `AgentReporter` instance per
 * project (typical: 4-5 reporters per repo). Each instance's `ensureDbPath`
 * runs `resolveDataPath(projectDir)` under `PathResolutionLive`, which
 * pulls in `WorkspacesLive` — a layer that eagerly scans lockfiles and
 * walks the workspace package graph. Without this cache, that scan
 * happens N times in serial during reporter init, adding seconds of
 * overhead to every `vitest run`.
 *
 * The cache is module-local: one entry per `projectDir` (in practice,
 * always `process.cwd()` for a single Vitest invocation), shared across
 * all reporter instances within the same Node process. Sufficient
 * because reporter instances are created in the main Vitest process,
 * not in worker forks.
 *
 * @internal
 */
const dbPathCache = new Map<string, Promise<string>>();

function resolveDataPathCached(projectDir: string): Promise<string> {
	const cached = dbPathCache.get(projectDir);
	if (cached !== undefined) return cached;
	const promise = Effect.runPromise(
		resolveDataPath(projectDir).pipe(Effect.provide(PathResolutionLive(projectDir)), Effect.provide(NodeContext.layer)),
	);
	dbPathCache.set(projectDir, promise);
	// Surface rejection to callers without leaving an unhandled-rejection
	// warning attached to the cached reference.
	promise.catch(() => undefined);
	return promise;
}

/**
 * Compute updated baselines using ratchet logic: take the max of actual vs previous,
 * capped by targets if set.
 *
 * @internal
 */
function computeUpdatedBaselines(
	existing: CoverageBaselines | undefined,
	actual: { statements: number; branches: number; functions: number; lines: number },
	targets: ResolvedThresholds | undefined,
): CoverageBaselines {
	const prev = existing?.global ?? {};
	const cap = targets?.global ?? {};

	const ratchet = (metric: "statements" | "branches" | "functions" | "lines"): number => {
		const actualVal = actual[metric];
		const prevVal = prev[metric] ?? 0;
		const targetVal = cap[metric];

		const newVal = Math.max(actualVal, prevVal);
		if (targetVal !== undefined && newVal > targetVal) {
			return targetVal;
		}
		return newVal;
	};

	return {
		updatedAt: new Date().toISOString(),
		global: {
			lines: ratchet("lines"),
			functions: ratchet("functions"),
			branches: ratchet("branches"),
			statements: ratchet("statements"),
		},
		patterns: existing?.patterns ?? [],
	};
}

/**
 * Fully resolved reporter options with all defaults applied.
 *
 * @internal
 */
interface ResolvedOptions {
	cacheDir?: string;
	consoleOutput: "failures" | "full" | "silent";
	omitPassingTests: boolean;
	coverageThresholds: ResolvedThresholds;
	coverageTargets?: ResolvedThresholds;
	autoUpdate: boolean;
	coverageConsoleLimit: number;
	includeBareZero: boolean;
	githubActions: boolean;
	githubSummary: boolean;
	githubSummaryFile: string | undefined;
	format?: "terminal" | "markdown" | "json" | "vitest-bypass" | "silent" | "ci-annotations";
	detail?: "minimal" | "neutral" | "standard" | "verbose";
	consoleMode: import("@vitest-agent/sdk").ConsoleMode;
	mcp?: boolean;
	projectFilter?: string;
	reporter: VitestAgentReporterFactory;
	/**
	 * Operating mode resolved by AgentPlugin from Vitest's coverage.enabled.
	 * Defaults to "full" when constructed directly (without the plugin).
	 */
	coverageMode: "full" | "ui-only";
	/** Transport binding threaded onto ResolvedReporterConfig for custom reporters. */
	transport: Transport;
	/**
	 * Project-level `test.passWithNoTests` captured from the resolved
	 * Vitest config and forwarded onto `ResolvedReporterConfig` for
	 * consumer reporters / UIs that want to render the resolved policy.
	 * The MCP `run_tests` tool does not read this snapshot — when its
	 * per-call override is unset the tool forwards nothing to
	 * `createVitest` and Vitest re-resolves from the project config.
	 */
	passWithNoTests?: boolean;
}

/**
 * Constructor argument shape for {@link AgentReporter}.
 *
 * The reporter is constructed by `AgentPlugin` in production with a
 * fully-resolved set of plugin-internal values; tests sometimes
 * construct it directly with a subset, so every field is optional and
 * the constructor applies internal defaults. Public consumers building
 * custom reporters do not touch this — they implement
 * `VitestAgentReporterFactory` and the plugin calls them with a
 * resolved `ReporterKit`.
 *
 * Extends the schema-defined {@link AgentReporterOptions} (which after
 * the 2.0 cleanup carries only `projectFilter`) plus the function-typed
 * and plugin-resolved fields the reporter needs at construction.
 */
export interface AgentReporterConstructorOptions extends AgentReporterOptions {
	reporter?: VitestAgentReporterFactory;
	/**
	 * Optional event tap. The reporter constructs a {@link RunEvent} for
	 * each Vitest streaming callback (`onTestRunStart`,
	 * `onTestModuleQueued`, `onTestModuleStart`, `onTestCaseResult`,
	 * `onTestModuleEnd`, `onTestRunEnd`) and invokes this callback with
	 * the event. Hosts drive a live renderer (Ink, debug logging, etc.)
	 * from here without coupling the reporter to a specific transport.
	 *
	 * Errors thrown by the callback are caught and written to stderr —
	 * a malfunctioning tap must not break persistence.
	 */
	onRunEvent?: (event: RunEvent) => void;
	/**
	 * Operating mode resolved by AgentPlugin from Vitest's coverage.enabled.
	 * Defaults to "full" when AgentReporter is constructed directly (without
	 * the plugin). Phase 5 uses this to short-circuit persistence when ui-only.
	 *
	 * @internal
	 */
	coverageMode?: "full" | "ui-only";
	consoleMode?: ConsoleMode;
	format?: OutputFormat;
	mcp?: boolean;
	githubActions?: boolean;
	transport?: Transport;
	/**
	 * Optional `test.passWithNoTests` value the plugin captured from the
	 * resolved Vitest config. The reporter forwards it onto the
	 * `ResolvedReporterConfig` it surfaces to renderers and the MCP
	 * `run_tests` tool.
	 */
	passWithNoTests?: boolean;
	coverageThresholds?: ResolvedThresholds | Record<string, unknown>;
	coverageTargets?: ResolvedThresholds | Record<string, unknown>;
	/**
	 * Test-only override: when set, bypasses the XDG path resolver and
	 * writes the SQLite database to `${cacheDir}/data.db`. Not a public
	 * user option — production deployments resolve the database path
	 * via the XDG / `vitest-agent.config.toml` stack inside the plugin.
	 *
	 * @internal
	 */
	cacheDir?: string;
}

/**
 * Vitest Reporter that produces structured output for LLM coding agents.
 *
 * @remarks
 * `AgentReporter` implements three Vitest Reporter lifecycle hooks:
 *
 * - {@link AgentReporter.onInit | onInit} -- stores the Vitest instance
 *   for project enumeration (used in Phase 2 overview generation)
 * - {@link AgentReporter.onCoverage | onCoverage} -- stashes the istanbul
 *   CoverageMap for merging into reports
 * - {@link AgentReporter.onTestRunEnd | onTestRunEnd} -- groups test
 *   modules by project, builds reports, writes data to SQLite,
 *   updates the manifest, and emits console/GFM output
 *
 * The reporter handles both single-package repos and monorepos by grouping
 * results via Vitest's native `TestProject` API. In single-project mode,
 * results are written with project name "default".
 *
 * @privateRemarks
 * The `onCoverage` hook fires **before** `onTestRunEnd` in Vitest's lifecycle.
 * Coverage data must be stashed as instance state and merged during
 * `onTestRunEnd`. This ordering is a Vitest design constraint, not a bug.
 *
 * @example
 * ```typescript
 * import { AgentReporter } from "@vitest-agent/plugin";
 * import { defineConfig } from "vitest/config";
 *
 * export default defineConfig({
 *   test: {
 *     reporters: [
 *       new AgentReporter({
 *         cacheDir: ".vitest-agent",
 *         consoleOutput: "failures",
 *         coverageThresholds: { global: { lines: 80 } },
 *       }),
 *     ],
 *   },
 * });
 * ```
 *
 * @see {@link AgentPlugin} for the convenience plugin wrapper
 * @see {@link AgentReporterOptions} for all configuration options
 * @see {@link https://vitest.dev/api/advanced/reporters.html | Vitest Reporter API}
 * @public
 */

export class AgentReporter {
	private options: ResolvedOptions;
	private dbPath: string | null = null;
	/**
	 * Set to `true` after the first `onTestRunEnd` invocation completes.
	 *
	 * Vitest can fire `onTestRunEnd` more than once per `vitest run` in
	 * some multi-project configurations (e.g., once per project group, with
	 * the same `testModules` array each time). The plugin pushes only ONE
	 * AgentReporter per run, so a fresh instance always starts with this
	 * flag `false`; the first call does the work and the flag prevents
	 * subsequent invocations from re-rendering and re-writing to the DB.
	 */
	private rendered = false;

	/**
	 * Stored Vitest instance from {@link AgentReporter.onInit | onInit}.
	 *
	 * @remarks
	 * Available for Phase 2 overview generation. Exposed as a public
	 * property (prefixed with `_`) for testing and extension purposes.
	 *
	 * @internal
	 */
	_vitest: unknown = null;
	private coverage: unknown = null;
	private logLevel: LogLevel.LogLevel | undefined;
	private logFile: string | undefined;
	private onRunEvent: ((event: RunEvent) => void) | undefined;
	/**
	 * Run-event channel. The plugin publishes one {@link RunEvent} per
	 * Vitest streaming callback onto this `PubSub`; the reporter factory
	 * receives it on the {@link ReporterKit} and a live-painting reporter
	 * (the default reporter in `stream` mode) subscribes to drive its mount.
	 * The plugin no longer owns any render mount itself.
	 *
	 * @internal
	 */
	private runEvents: PubSub.PubSub<RunEvent>;
	/**
	 * Reporters resolved from the factory at run start (`onInit`). Reused
	 * by `onTestRunEnd` for the `render` call. Undefined when `onInit` did
	 * not run (tests invoking `onTestRunEnd` directly) — `onTestRunEnd`
	 * then resolves the factory itself.
	 *
	 * @internal
	 */
	private reporters: ReadonlyArray<VitestAgentReporter> | undefined;
	/**
	 * Whether the user supplied a custom `reporter` factory. A custom
	 * reporter may subscribe to the run-event channel in any console mode,
	 * so the streaming hooks publish events whenever this is true.
	 *
	 * @internal
	 */
	private readonly hasCustomReporter: boolean;
	private currentRunId: string | null = null;
	private moduleStartedAt: Map<string, string> = new Map();
	/**
	 * Wall-clock start stamp (`Date.now()`) for an in-flight Vitest
	 * setup/teardown hook, keyed `modulePath::hookType::scopeName`.
	 * `onHookStart` writes it, `onHookEnd` reads and clears it to derive
	 * `HookFinished.durationMs` — `ReportedHookContext` carries no
	 * duration of its own.
	 *
	 * @internal
	 */
	private hookStartedAt: Map<string, number> = new Map();

	constructor(options: AgentReporterConstructorOptions = {}) {
		// logLevel and logFile read from VITEST_REPORTER_LOG_LEVEL /
		// VITEST_REPORTER_LOG_FILE env vars — no user option threading.
		this.logLevel = resolveLogLevel();
		this.logFile = resolveLogFile();
		this.onRunEvent = options.onRunEvent;
		this.hasCustomReporter = options.reporter !== undefined;

		// The run-event channel. Created unconditionally — it is cheap, and
		// whether anything subscribes is decided downstream: the default
		// reporter subscribes only in `stream` mode, a custom reporter may
		// subscribe in any mode, and the user `onRunEvent` tap is fed
		// alongside the channel. The plugin only publishes; the reporter
		// owns every render mount (including the live Ink mount).
		this.runEvents = Effect.runSync(PubSub.unbounded<RunEvent>());

		// coverageThresholds may be a raw Vitest format (Record<string, unknown>)
		// when AgentReporter is used directly without AgentPlugin. Resolve it.
		const rawThresholds = options.coverageThresholds as Record<string, unknown> | ResolvedThresholds | undefined;
		const resolvedThresholds: ResolvedThresholds =
			rawThresholds && "global" in rawThresholds
				? (rawThresholds as ResolvedThresholds)
				: resolveThresholds(rawThresholds);

		const rawTargets = options.coverageTargets as Record<string, unknown> | ResolvedThresholds | undefined;
		const resolvedTargets: ResolvedThresholds | undefined = rawTargets
			? "global" in rawTargets
				? (rawTargets as ResolvedThresholds)
				: resolveThresholds(rawTargets)
			: undefined;

		// Derive renderer-internal defaults from the resolved console mode.
		const consoleMode: ConsoleMode = options.consoleMode ?? "passthrough";
		const consoleOutput: "failures" | "full" | "silent" = consoleMode === "silent" ? "silent" : "failures";
		// When AgentReporter is constructed directly (without AgentPlugin),
		// derive `format` from `consoleMode` so a `silent` mode still
		// short-circuits the output pipeline. The plugin passes an
		// already-resolved format; this fallback only fires when callers
		// (mostly tests) skip it.
		const derivedFormat: OutputFormat | undefined =
			options.format ??
			(consoleMode === "silent"
				? "silent"
				: consoleMode === "stream" || consoleMode === "agent"
					? "terminal"
					: consoleMode === "ci-annotations"
						? "ci-annotations"
						: undefined);
		const githubActions = options.githubActions ?? false;
		const base: ResolvedOptions = {
			...(options.cacheDir !== undefined ? { cacheDir: options.cacheDir } : {}),
			consoleOutput,
			omitPassingTests: true,
			coverageThresholds: resolvedThresholds,
			autoUpdate: true,
			coverageConsoleLimit: 10,
			includeBareZero: false,
			githubActions,
			githubSummary: githubActions,
			githubSummaryFile: undefined,
			...(derivedFormat !== undefined ? { format: derivedFormat } : {}),
			consoleMode,
			...(options.mcp !== undefined ? { mcp: options.mcp } : {}),
			...(options.projectFilter !== undefined ? { projectFilter: options.projectFilter } : {}),
			reporter: options.reporter ?? DefaultVitestAgentReporter,
			coverageMode: options.coverageMode ?? "full",
			transport: options.transport ?? { kind: "local" },
			...(options.passWithNoTests !== undefined ? { passWithNoTests: options.passWithNoTests } : {}),
		};
		this.options = resolvedTargets ? { ...base, coverageTargets: resolvedTargets } : base;
	}

	/**
	 * The resolved reporter config built at construction time. Exposed for
	 * test inspection and Phase 5 short-circuit logic.
	 *
	 * This getter is @internal — do not reference in user-facing docs.
	 * @internal
	 */
	get resolvedConfig(): import("@vitest-agent/sdk").ResolvedReporterConfig {
		const opts = this.options;
		return {
			executor: "ci", // placeholder — kit is assembled per-run; this getter exposes construction-time config only
			consoleMode: opts.consoleMode,
			mcp: opts.mcp ?? false,
			consoleOutput: opts.consoleOutput,
			omitPassingTests: opts.omitPassingTests,
			coverageConsoleLimit: opts.coverageConsoleLimit,
			includeBareZero: opts.includeBareZero,
			githubActions: opts.githubActions,
			githubSummary: opts.githubSummary,
			format: opts.format ?? "vitest-bypass",
			detail: opts.detail ?? "standard",
			noColor: false,
			coverageMode: opts.coverageMode,
			transport: opts.transport,
			...(opts.coverageThresholds !== undefined && { coverageThresholds: opts.coverageThresholds }),
			...(opts.coverageTargets !== undefined && { coverageTargets: opts.coverageTargets }),
			...(opts.passWithNoTests !== undefined && { passWithNoTests: opts.passWithNoTests }),
		};
	}

	/**
	 * Store the Vitest instance for project enumeration.
	 *
	 * @remarks
	 * Called once at the start of the test run. The instance is stored
	 * for Phase 2 overview generation via `vitest.projects`.
	 *
	 * @param vitest - The Vitest instance
	 */
	async onInit(vitest: unknown): Promise<void> {
		this._vitest = vitest;
		await this.ensureDbPath();
		await this.initReporters();
	}

	/**
	 * Resolve the reporter factory at run start.
	 *
	 * The factory is invoked here — before any streaming hook fires — so a
	 * reporter that paints live (the default reporter's Ink mount in `stream`
	 * mode) can subscribe to {@link AgentReporter.runEvents | the run-event
	 * channel} before the first `RunStarted` event. The kit built here
	 * carries neutral run health; `detail` is resolved health-aware again
	 * for the render kit at `onTestRunEnd`, and that kit is the one handed
	 * to `render`.
	 *
	 * A resolution failure degrades silently: `this.reporters` stays unset
	 * and `onTestRunEnd` resolves the factory itself from the render kit.
	 *
	 * @internal
	 */
	private async initReporters(): Promise<void> {
		const opts = this.options;
		try {
			const initProgram = Effect.gen(function* () {
				const detector = yield* EnvironmentDetector;
				const executorResolver = yield* ExecutorResolver;
				const formatSelector = yield* FormatSelector;
				const detailResolver = yield* DetailResolver;
				const env = yield* detector.detect();
				const executor = yield* executorResolver.resolve(env);
				const format = yield* formatSelector.select(executor, opts.format, env);
				const detail = yield* detailResolver.resolve(
					executor,
					{ hasFailures: false, belowTargets: false, hasTargets: !!opts.coverageTargets },
					opts.detail,
				);
				return { env, executor, format, detail };
			});
			const { env, executor, format, detail } = await Effect.runPromise(
				initProgram.pipe(Effect.provide(OutputPipelineLive), Effect.provide(NodeContext.layer)),
			);
			const kit = buildReporterKit({
				env,
				executor,
				format,
				detail,
				noColor: !!process.env.NO_COLOR,
				consoleMode: opts.consoleMode ?? "passthrough",
				mcp: opts.mcp ?? false,
				githubActions: opts.githubActions,
				transport: opts.transport,
				runEvents: this.runEvents,
				...(this.dbPath !== null && { dbPath: this.dbPath }),
				...(opts.projectFilter !== undefined && { projectFilter: opts.projectFilter }),
				...(opts.coverageThresholds !== undefined && { coverageThresholds: opts.coverageThresholds }),
				...(opts.coverageTargets !== undefined && { coverageTargets: opts.coverageTargets }),
				...(opts.passWithNoTests !== undefined && { passWithNoTests: opts.passWithNoTests }),
				coverageMode: opts.coverageMode,
			});
			this.reporters = normalizeReporters(opts.reporter(kit));
		} catch (err) {
			process.stderr.write(`vitest-agent: reporter init failed; retrying at run end (${formatFatalError(err)})\n`);
		}
	}

	/**
	 * Should the streaming Vitest hooks publish {@link RunEvent}s? The
	 * hooks short-circuit when this is false to skip constructing event
	 * objects nothing will read: the default reporter consumes the channel
	 * only in `stream` mode, a custom reporter may consume it in any mode,
	 * and the user `onRunEvent` tap is fed off the same stream.
	 *
	 * @internal
	 */
	private wantsRunEvents(): boolean {
		return this.onRunEvent !== undefined || this.options.consoleMode === "stream" || this.hasCustomReporter;
	}

	/**
	 * Publish a {@link RunEvent} onto the run-event channel and the
	 * user-supplied tap. A throwing publish or tap is caught and logged to
	 * stderr — a live-render bug must not break persistence.
	 *
	 * @internal
	 */
	private emit(event: RunEvent): void {
		try {
			Effect.runSync(PubSub.publish(this.runEvents, event));
		} catch (err) {
			process.stderr.write(`vitest-agent: run-event publish threw: ${formatFatalError(err)}\n`);
		}
		const tap = this.onRunEvent;
		if (tap !== undefined) {
			try {
				tap(event);
			} catch (err) {
				process.stderr.write(`vitest-agent: onRunEvent tap threw: ${formatFatalError(err)}\n`);
			}
		}
	}

	/**
	 * Walk the suite parent chain to produce the suite-path array used
	 * in {@link RunEvent.TestStarted} / {@link RunEvent.TestFinished}.
	 *
	 * @internal
	 */
	private collectSuitePath(testCase: { parent?: { type: string; name: string; parent?: unknown } }): string[] {
		const path: string[] = [];
		let cursor: { type: string; name: string; parent?: unknown } | undefined = testCase.parent;
		while (cursor !== undefined && cursor.type === "suite") {
			path.unshift(cursor.name);
			cursor = cursor.parent as typeof cursor;
		}
		return path;
	}

	/**
	 * Vitest streaming hook: a test run is about to start. Mints a
	 * synthetic `runId` for the duration of this run and emits a
	 * `RunStarted` event for live subscribers.
	 */
	onTestRunStart(_specifications: ReadonlyArray<unknown>): void {
		if (!this.wantsRunEvents()) return;
		this.currentRunId = randomUUID();
		this.moduleStartedAt.clear();
		this.emit({
			_tag: "RunStarted",
			runId: this.currentRunId,
			startedAt: new Date().toISOString(),
			configHash: "live",
		});
	}

	/**
	 * Read the owning Vitest project name off a `TestModule`. Vitest 4.x
	 * attaches `project` to every module; an empty name (the unnamed
	 * default project) collapses to `undefined` so the renderer treats it
	 * as a single anonymous project.
	 *
	 * @internal
	 */
	private moduleProjectName(testModule: { project?: { name?: string } }): string | undefined {
		const name = testModule.project?.name;
		return name !== undefined && name.length > 0 ? name : undefined;
	}

	/**
	 * Vitest streaming hook: a test module has been queued.
	 */
	onTestModuleQueued(testModule: { relativeModuleId: string; project?: { name?: string } }): void {
		if (!this.wantsRunEvents()) return;
		const projectName = this.moduleProjectName(testModule);
		this.emit({
			_tag: "ModuleQueued",
			modulePath: testModule.relativeModuleId,
			...(projectName !== undefined && { projectName }),
		});
	}

	/**
	 * Vitest streaming hook: a test module is starting execution.
	 */
	onTestModuleStart(testModule: { relativeModuleId: string; project?: { name?: string } }): void {
		if (!this.wantsRunEvents()) return;
		const startedAt = new Date().toISOString();
		this.moduleStartedAt.set(testModule.relativeModuleId, startedAt);
		const projectName = this.moduleProjectName(testModule);
		this.emit({
			_tag: "ModuleStarted",
			modulePath: testModule.relativeModuleId,
			startedAt,
			...(projectName !== undefined && { projectName }),
		});
	}

	/**
	 * Vitest streaming hook: a test module has finished collecting its
	 * tests and suites, before execution begins.
	 */
	onTestModuleCollected(testModule: {
		relativeModuleId: string;
		children: { allTests(filter?: string): Iterable<unknown>; allSuites(): Iterable<unknown> };
	}): void {
		if (!this.wantsRunEvents()) return;
		let testCount = 0;
		for (const _ of testModule.children.allTests()) testCount++;
		let suiteCount = 0;
		for (const _ of testModule.children.allSuites()) suiteCount++;
		this.emit({ _tag: "ModuleCollected", modulePath: testModule.relativeModuleId, testCount, suiteCount });
	}

	/**
	 * Vitest streaming hook: a test case is about to run.
	 *
	 * Emits a standalone `TestStarted` so the renderer gets a render
	 * frame for the transient "running" state. `onTestCaseReady` fires
	 * before `onTestCaseResult`; emitting here — rather than synthesizing
	 * `TestStarted` back-to-back with `TestFinished` inside
	 * `onTestCaseResult` — gives the running state a real lifetime in the
	 * event stream and is the prerequisite for any future per-test
	 * animation.
	 */
	onTestCaseReady(testCase: {
		name: string;
		parent?: { type: string; name: string; parent?: unknown };
		module?: { relativeModuleId: string };
	}): void {
		if (!this.wantsRunEvents()) return;
		const modulePath = testCase.module?.relativeModuleId ?? "";
		if (modulePath === "") return;
		this.emit({
			_tag: "TestStarted",
			modulePath,
			testName: testCase.name,
			suitePath: this.collectSuitePath(testCase),
		});
	}

	/**
	 * Vitest streaming hook: a test case has produced a result.
	 *
	 * Emits only `TestFinished` — the matching `TestStarted` is emitted
	 * by `onTestCaseReady`, which fires earlier in the lifecycle.
	 */
	onTestCaseResult(testCase: {
		name: string;
		parent?: { type: string; name: string; parent?: unknown };
		module?: { relativeModuleId: string };
		result():
			| {
					state: string;
					errors?: ReadonlyArray<{
						message: string;
						diff?: string;
						expected?: unknown;
						actual?: unknown;
						stacks?: ReadonlyArray<unknown>;
					}>;
			  }
			| undefined;
		diagnostic(): { duration: number } | undefined;
	}): void {
		if (!this.wantsRunEvents()) return;
		const modulePath = testCase.module?.relativeModuleId ?? "";
		if (modulePath === "") return;
		const suitePath = this.collectSuitePath(testCase);
		const result = testCase.result();
		const diag = testCase.diagnostic();
		const status =
			result?.state === "passed" || result?.state === "failed" || result?.state === "skipped"
				? result.state
				: "pending";
		const firstError = result?.errors?.[0];
		const expectedStr = stringifyFailureValue(firstError?.expected);
		const receivedStr = stringifyFailureValue(firstError?.actual);
		const error =
			firstError !== undefined
				? {
						message: firstError.message,
						...(firstError.diff !== undefined && { diff: firstError.diff }),
						...(expectedStr !== undefined && { expected: expectedStr }),
						...(receivedStr !== undefined && { received: receivedStr }),
					}
				: undefined;
		const timedOut = result?.state === "failed" && firstError !== undefined && isTimeoutError(firstError);
		this.emit({
			_tag: "TestFinished",
			modulePath,
			testName: testCase.name,
			suitePath,
			status,
			durationMs: diag?.duration ?? 0,
			...(error !== undefined && { error }),
			...(timedOut && { timedOut: true }),
		});
	}

	/**
	 * Vitest streaming hook: a test module has finished. Emits a
	 * `ModuleFinished` carrying the tallied counts plus a duration
	 * derived from the module's diagnostic.
	 */
	onTestModuleEnd(testModule: {
		relativeModuleId: string;
		project?: { name?: string };
		children: {
			allTests(filter?: string): Iterable<{
				result(): { state: string; errors?: ReadonlyArray<{ message: string; name?: string }> } | undefined;
				tags?: ReadonlyArray<string>;
			}>;
		};
		diagnostic(): { duration: number } | undefined;
	}): void {
		if (!this.wantsRunEvents()) return;
		let pass = 0;
		let fail = 0;
		let skip = 0;
		let timeout = 0;
		for (const test of testModule.children.allTests()) {
			const result = test.result();
			const state = result?.state;
			if (state === "passed") pass++;
			else if (state === "failed") {
				const firstError = result?.errors?.[0];
				if (firstError !== undefined && isTimeoutError(firstError)) timeout++;
				else fail++;
			} else skip++;
		}
		const tagCounts: Record<string, number> = {};
		for (const test of testModule.children.allTests()) {
			for (const tag of test.tags ?? []) {
				tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
			}
		}
		const projectName = this.moduleProjectName(testModule);
		this.emit({
			_tag: "ModuleFinished",
			modulePath: testModule.relativeModuleId,
			passCount: pass,
			failCount: fail,
			skipCount: skip,
			timeoutCount: timeout,
			durationMs: testModule.diagnostic()?.duration ?? 0,
			...(projectName !== undefined && { projectName }),
			...(Object.keys(tagCounts).length > 0 && { tagCounts }),
		});
	}

	/**
	 * Walk a suite/test entity's parent chain to its owning module path.
	 *
	 * @internal
	 */
	private entityModulePath(entity: { relativeModuleId?: string; module?: { relativeModuleId?: string } }): string {
		return entity.relativeModuleId ?? entity.module?.relativeModuleId ?? "";
	}

	/**
	 * Vitest streaming hook: a test suite is about to run.
	 */
	onTestSuiteReady(testSuite: {
		name: string;
		module?: { relativeModuleId?: string };
		parent?: { type: string; name: string; parent?: unknown };
	}): void {
		if (!this.wantsRunEvents()) return;
		const modulePath = this.entityModulePath(testSuite);
		if (modulePath === "") return;
		this.emit({
			_tag: "SuiteStarted",
			modulePath,
			suitePath: this.collectSuitePath(testSuite),
			suiteName: testSuite.name,
		});
	}

	/**
	 * Vitest streaming hook: a test suite has finished running.
	 */
	onTestSuiteResult(testSuite: {
		name: string;
		module?: { relativeModuleId?: string };
		parent?: { type: string; name: string; parent?: unknown };
		children: { allTests(filter?: string): Iterable<{ result(): { state: string } | undefined }> };
	}): void {
		if (!this.wantsRunEvents()) return;
		const modulePath = this.entityModulePath(testSuite);
		if (modulePath === "") return;
		let pass = 0;
		let fail = 0;
		let skip = 0;
		for (const test of testSuite.children.allTests()) {
			const state = test.result()?.state;
			if (state === "passed") pass++;
			else if (state === "failed") fail++;
			else skip++;
		}
		this.emit({
			_tag: "SuiteFinished",
			modulePath,
			suitePath: this.collectSuitePath(testSuite),
			suiteName: testSuite.name,
			passCount: pass,
			failCount: fail,
			skipCount: skip,
		});
	}

	/**
	 * Derive `modulePath` / `scopeName` / a stable key for a Vitest
	 * setup/teardown hook from its `ReportedHookContext` entity.
	 *
	 * @internal
	 */
	private hookScope(hook: {
		name: string;
		entity?: { name?: string; relativeModuleId?: string; module?: { relativeModuleId?: string } };
	}): { modulePath: string; scopeName: string } {
		const entity = hook.entity ?? {};
		const modulePath = entity.relativeModuleId ?? entity.module?.relativeModuleId ?? "";
		const scopeName = entity.name ?? entity.relativeModuleId ?? "";
		return { modulePath, scopeName };
	}

	/**
	 * Vitest streaming hook: a `beforeAll` / `afterAll` / `beforeEach` /
	 * `afterEach` hook is starting.
	 */
	onHookStart(hook: {
		name: string;
		entity?: { name?: string; relativeModuleId?: string; module?: { relativeModuleId?: string } };
	}): void {
		if (!this.wantsRunEvents()) return;
		if (
			hook.name !== "beforeAll" &&
			hook.name !== "afterAll" &&
			hook.name !== "beforeEach" &&
			hook.name !== "afterEach"
		)
			return;
		const { modulePath, scopeName } = this.hookScope(hook);
		this.hookStartedAt.set(`${modulePath}::${hook.name}::${scopeName}`, Date.now());
		this.emit({ _tag: "HookStarted", modulePath, hookType: hook.name, scopeName });
	}

	/**
	 * Vitest streaming hook: a setup/teardown hook has finished. Duration
	 * is derived from the stamp `onHookStart` recorded — `ReportedHookContext`
	 * carries none of its own. Status is a best-effort read of the
	 * entity's collected errors.
	 */
	onHookEnd(hook: {
		name: string;
		entity?: {
			name?: string;
			relativeModuleId?: string;
			module?: { relativeModuleId?: string };
			errors?: () => ReadonlyArray<{ message: string; stack?: string; diff?: string }>;
		};
	}): void {
		if (!this.wantsRunEvents()) return;
		if (
			hook.name !== "beforeAll" &&
			hook.name !== "afterAll" &&
			hook.name !== "beforeEach" &&
			hook.name !== "afterEach"
		)
			return;
		const { modulePath, scopeName } = this.hookScope(hook);
		const key = `${modulePath}::${hook.name}::${scopeName}`;
		const startedAt = this.hookStartedAt.get(key);
		this.hookStartedAt.delete(key);
		const durationMs = startedAt !== undefined ? Date.now() - startedAt : 0;
		const entityErrors = typeof hook.entity?.errors === "function" ? hook.entity.errors() : [];
		const firstError = entityErrors[0];
		this.emit({
			_tag: "HookFinished",
			modulePath,
			hookType: hook.name,
			scopeName,
			durationMs,
			status: entityErrors.length > 0 ? "failed" : "passed",
			...(firstError !== undefined && {
				error: {
					message: firstError.message,
					...(firstError.stack !== undefined && { stack: firstError.stack }),
					...(firstError.diff !== undefined && { diff: firstError.diff }),
				},
			}),
		});
	}

	/**
	 * Vitest streaming hook: a captured `console.log` / `console.error`
	 * from user test code. The Vitest log carries a `taskId` rather than
	 * a module/test path; resolving it back to one would need the task
	 * registry, so `modulePath` / `testName` are left unset.
	 */
	onUserConsoleLog(log: { content: string; type: "stdout" | "stderr"; time: number }): void {
		if (!this.wantsRunEvents()) return;
		this.emit({ _tag: "ConsoleLog", level: log.type, content: log.content, time: log.time });
	}

	/**
	 * Vitest streaming hook: the run exceeded its configured process
	 * timeout. Terminal — moves the renderer to a final frame.
	 */
	onProcessTimeout(): void {
		if (!this.wantsRunEvents()) return;
		this.emit({ _tag: "RunTimedOut", message: "Test run exceeded the configured process timeout." });
	}

	/**
	 * Vitest streaming hook: a test case recorded an annotation.
	 */
	onTestCaseAnnotate(
		testCase: {
			name: string;
			parent?: { type: string; name: string; parent?: unknown };
			module?: { relativeModuleId: string };
		},
		annotation: { message: string },
	): void {
		if (!this.wantsRunEvents()) return;
		const modulePath = testCase.module?.relativeModuleId ?? "";
		if (modulePath === "") return;
		this.emit({
			_tag: "TestAnnotated",
			modulePath,
			testName: testCase.name,
			suitePath: this.collectSuitePath(testCase),
			annotation: annotation.message,
		});
	}

	/**
	 * Vitest streaming hook: a test case recorded an artifact.
	 */
	onTestCaseArtifactRecord(
		testCase: {
			name: string;
			parent?: { type: string; name: string; parent?: unknown };
			module?: { relativeModuleId: string };
		},
		artifact: { type?: string },
	): void {
		if (!this.wantsRunEvents()) return;
		const modulePath = testCase.module?.relativeModuleId ?? "";
		if (modulePath === "") return;
		this.emit({
			_tag: "TestArtifactRecorded",
			modulePath,
			testName: testCase.name,
			suitePath: this.collectSuitePath(testCase),
			artifact: artifact.type ?? "artifact",
		});
	}

	/**
	 * Vitest streaming hook: watch mode has finished its initial run and
	 * is waiting for file changes.
	 */
	onWatcherStart(): void {
		if (!this.wantsRunEvents()) return;
		this.emit({ _tag: "WatcherReady" });
	}

	/**
	 * Vitest streaming hook: watch mode is re-running because tracked
	 * files changed.
	 */
	onWatcherRerun(files: ReadonlyArray<string>, trigger?: string): void {
		if (!this.wantsRunEvents()) return;
		this.emit({
			_tag: "WatcherRerun",
			triggerFiles: [...files],
			...(trigger !== undefined && { reason: trigger }),
		});
	}

	private async ensureDbPath(): Promise<string> {
		if (this.dbPath) return this.dbPath;
		// Programmatic cacheDir override: skip the heavy XDG/workspace layer
		// stack entirely. WorkspacesLive eagerly scans lockfiles and walks the
		// package graph at layer construction, which is wasted work when the
		// caller already supplied a literal path.
		if (this.options.cacheDir) {
			mkdirSync(this.options.cacheDir, { recursive: true });
			this.dbPath = `${this.options.cacheDir}/data.db`;
			return this.dbPath;
		}
		// Memoized across reporter instances for the same projectDir so
		// multi-project Vitest configs don't run WorkspacesLive's lockfile
		// scan once per reporter (5+ scans in typical monorepos).
		const projectDir = process.cwd();
		this.dbPath = await resolveDataPathCached(projectDir);
		return this.dbPath;
	}

	/**
	 * Stash coverage data for merging into reports.
	 *
	 * @privateRemarks
	 * This hook fires **before** `onTestRunEnd` in Vitest's lifecycle.
	 * The coverage value is an istanbul CoverageMap that will be duck-typed
	 * and processed during `onTestRunEnd`.
	 *
	 * @param coverage - Istanbul CoverageMap (duck-typed at processing time)
	 *
	 * @see {@link processCoverage} for the duck-typing logic
	 */
	onCoverage(coverage: unknown): void {
		this.coverage = coverage;
	}

	/**
	 * Process test results, write reports, and emit formatted output.
	 *
	 * @remarks
	 * This is the main lifecycle hook where all output is generated.
	 * Processing steps:
	 *
	 * 1. Group test modules by `testModule.project.name`
	 * 2. Process stashed coverage data (if available)
	 * 3. Build per-project {@link AgentReport} objects
	 * 4. Classify tests via HistoryTracker and attach classifications
	 * 5. Write settings, run, modules, test cases, and errors to SQLite
	 * 6. Write per-test history entries
	 * 7. Write baselines and trends
	 * 8. Emit console markdown (unless `"silent"`)
	 * 9. Write GFM summary to `GITHUB_STEP_SUMMARY` (if GitHub Actions)
	 *
	 * File write failures are logged to stderr but do not crash the test run.
	 *
	 * @param testModules - All test modules from the completed run
	 * @param unhandledErrors - Any unhandled errors during the run
	 * @param reason - Overall outcome: `"passed"`, `"failed"`, or `"interrupted"`
	 */
	async onTestRunEnd(
		testModules: ReadonlyArray<unknown>,
		unhandledErrors: ReadonlyArray<unknown>,
		reason: "passed" | "failed" | "interrupted",
	): Promise<void> {
		// Idempotence: in some multi-project configs Vitest fires
		// onTestRunEnd more than once per `vitest run` against the same
		// reporter instance. The first invocation writes the DB and renders
		// the output; subsequent ones must no-op or we'll double-write
		// trend rows and duplicate the stdout block.
		if (this.rendered) return;
		this.rendered = true;

		// Emit RunFinished before the heavy persistence pipeline so a live
		// subscriber's terminal frame stays correlated with the events it
		// has already seen. The streaming counts are aggregated from the
		// per-module passes that landed during the run; we cannot wait for
		// the post-aggregation summary to fire RunFinished without
		// breaking the live UX. The live Ink mount schedules its own
		// unmount on next tick once it sees this event (see
		// LiveInkRenderer.tsx).
		if (this.wantsRunEvents() && this.currentRunId !== null) {
			let pass = 0;
			let fail = 0;
			let skip = 0;
			let timeout = 0;
			let totalDuration = 0;
			for (const mod of testModules as ReadonlyArray<{
				children: {
					allTests(filter?: string): Iterable<{
						result(): { state: string; errors?: ReadonlyArray<{ message: string; name?: string }> } | undefined;
					}>;
				};
				diagnostic(): { duration: number } | undefined;
			}>) {
				totalDuration += mod.diagnostic()?.duration ?? 0;
				for (const test of mod.children.allTests()) {
					const result = test.result();
					const state = result?.state;
					if (state === "passed") pass++;
					else if (state === "failed") {
						const firstError = result?.errors?.[0];
						if (firstError !== undefined && isTimeoutError(firstError)) timeout++;
						else fail++;
					} else skip++;
				}
			}
			this.emit({
				_tag: "RunFinished",
				runId: this.currentRunId,
				finishedAt: new Date().toISOString(),
				passCount: pass,
				failCount: fail,
				skipCount: skip,
				timeoutCount: timeout,
				durationMs: totalDuration,
			});
		}

		const modules = testModules as ReadonlyArray<VitestTestModule>;
		const errors = unhandledErrors as ReadonlyArray<{ message: string; stack?: string }>;

		// Capture options for use inside Effect.gen
		const opts = this.options;
		const stashedCoverage = this.coverage;
		const stashedVitest = this._vitest;
		const logLevel = this.logLevel;
		const logFile = this.logFile;
		// The run-event channel and the reporters resolved at run start
		// (onInit). `preBuiltReporters` is undefined only when onInit did
		// not run — tests invoking onTestRunEnd directly — in which case
		// the factory is resolved here from the render kit instead.
		const runEvents = this.runEvents;
		const preBuiltReporters = this.reporters;
		// Bound emit closure so the Effect.gen program below (a plain
		// generator function with no `this`) can publish coverage events
		// once the CoverageAnalyzer result is in hand.
		const emitEvent = (event: RunEvent): void => {
			this.emit(event);
		};
		const wantsRunEvents = this.wantsRunEvents();

		// Resolve dbPath if onInit didn't run (e.g. unit tests calling
		// onTestRunEnd directly). Memoized after first resolution.
		let dbPath: string;
		try {
			dbPath = await this.ensureDbPath();
		} catch (err) {
			process.stderr.write(`vitest-agent: ${formatFatalError(err)}\n`);
			return;
		}

		// Filter modules to this reporter's project if projectFilter is set
		// (multi-project mode: each reporter instance handles its own project)
		const filteredModules = opts.projectFilter
			? modules.filter((m) => (m.project.name || "default") === opts.projectFilter)
			: modules;

		if (filteredModules.length === 0 && opts.projectFilter) {
			return;
		}

		// UI-only mode: skip the entire persistence pipeline (DataStore, CoverageAnalyzer,
		// HistoryTracker) and build an in-memory report for the renderer only.
		// Streaming taps (onTestRunStart, onTestCaseResult, etc.) and the RunFinished
		// event above have already fired — no change needed there. The user-supplied
		// reporter factory is still called so the renderer produces output.
		if (opts.coverageMode === "ui-only") {
			// Group modules by project name (same logic as Full path)
			const uiProjectGroups = new Map<string, VitestTestModule[]>();
			for (const mod of filteredModules) {
				const key = mod.project.name || "default";
				const existing = uiProjectGroups.get(key);
				if (existing) {
					existing.push(mod);
				} else {
					uiProjectGroups.set(key, [mod]);
				}
			}

			// Build in-memory AgentReports via the pure buildAgentReport helper
			const isMultiProject = uiProjectGroups.size > 1 || !!opts.projectFilter;
			const uiReports: AgentReport[] = [];
			for (const [projectName, projectModules] of uiProjectGroups) {
				const report = buildAgentReport(
					projectModules,
					errors,
					reason,
					{ omitPassingTests: opts.omitPassingTests },
					isMultiProject ? projectName : undefined,
				);
				uiReports.push(report);
			}

			// Resolve env/executor/format/detail via the four output-pipeline services only.
			// No DataStore, DataReader, CoverageAnalyzer, or HistoryTracker needed.
			const uiProgram = Effect.gen(function* () {
				const detector = yield* EnvironmentDetector;
				const executorResolver = yield* ExecutorResolver;
				const formatSelector = yield* FormatSelector;
				const detailResolver = yield* DetailResolver;

				const env = yield* detector.detect();
				const executor = yield* executorResolver.resolve(env);
				const format = yield* formatSelector.select(executor, opts.format, env);
				const health = {
					hasFailures: uiReports.some((r) => r.summary.failed > 0 || r.unhandledErrors.length > 0),
					belowTargets: false,
					hasTargets: !!opts.coverageTargets,
				};
				const detail = yield* detailResolver.resolve(executor, health, opts.detail);

				const githubSummaryFile = process.env.GITHUB_STEP_SUMMARY;
				const kit = buildReporterKit({
					env,
					executor,
					format,
					detail,
					noColor: !!process.env.NO_COLOR,
					consoleMode: opts.consoleMode ?? "passthrough",
					mcp: opts.mcp ?? false,
					githubActions: opts.githubActions,
					transport: opts.transport,
					runEvents,
					...(dbPath !== undefined && { dbPath }),
					...(opts.projectFilter !== undefined && { projectFilter: opts.projectFilter }),
					...(opts.coverageThresholds !== undefined && { coverageThresholds: opts.coverageThresholds }),
					...(opts.coverageTargets !== undefined && { coverageTargets: opts.coverageTargets }),
					...(opts.passWithNoTests !== undefined && { passWithNoTests: opts.passWithNoTests }),
					coverageMode: opts.coverageMode,
				});

				// Reuse the reporters resolved at run start; resolve the factory
				// here only when onInit did not run. The render kit (this `kit`)
				// is health-aware and is the one handed to `render`.
				const reporters = preBuiltReporters ?? normalizeReporters(opts.reporter(kit));
				// No history → classifications are empty; no trends → trendSummary is undefined
				const renderInput = {
					reports: uiReports,
					classifications: new Map<string, TestClassification>(),
				};
				const allOutputs = reporters.flatMap((r) => r.render(renderInput, kit));
				for (const output of allOutputs) {
					routeRenderedOutput(output, {
						...(githubSummaryFile !== undefined && { githubSummaryFile }),
					});
				}
			});

			await Effect.runPromise(
				uiProgram.pipe(Effect.provide(OutputPipelineLive), Effect.provide(NodeContext.layer)),
			).catch((err) => {
				process.stderr.write(`vitest-agent: ${formatFatalError(err)}\n`);
			});
			return;
		}

		// resolveDataPath in onInit already created the parent directory; this
		// mkdirSync is a defensive no-op for users who skip onInit (none in
		// production, but tests sometimes invoke onTestRunEnd directly).
		mkdirSync(dirname(dbPath), { recursive: true });

		// Serialize migrations across reporter instances in the same process.
		// Multi-project Vitest runs create one reporter per project, all sharing
		// the same dbPath. Concurrent migration attempts on a fresh database hit
		// SQLITE_BUSY (database is locked) because deferred-transaction write
		// upgrades don't invoke SQLite's busy_handler. After this resolves,
		// concurrent reads/writes from separate connections work under WAL mode.
		try {
			await ensureMigrated(dbPath, logLevel, logFile);
		} catch (err) {
			process.stderr.write(`vitest-agent: ${formatFatalError(err)}\n`);
			return;
		}

		const program = Effect.gen(function* () {
			const store = yield* DataStore;
			const reader = yield* DataReader;
			const analyzer = yield* CoverageAnalyzer;
			const tracker = yield* HistoryTracker;

			// Generate invocation ID
			const invocationId = randomUUID();

			// Capture settings from the Vitest instance stored in onInit
			const vitest = stashedVitest as { config?: Record<string, unknown>; version?: string } | null;
			const vitestConfig = (vitest?.config ?? {}) as Record<string, unknown>;
			const vitestVersion = (vitest?.version as string) ?? "unknown";
			const settings = captureSettings(vitestConfig, vitestVersion);
			const settingsHash = hashSettings(settings as unknown as Record<string, unknown>);
			const envVars = captureEnvVars(process.env as Record<string, string | undefined>);

			// Write settings (idempotent -- INSERT OR IGNORE)
			yield* store.writeSettings(settingsHash, settings, envVars);

			// Group modules by project name
			const projectGroups = new Map<string, VitestTestModule[]>();
			for (const mod of filteredModules) {
				const name = mod.project.name;
				const key = name || "default";
				const existing = projectGroups.get(key);
				if (existing) {
					existing.push(mod);
				} else {
					projectGroups.set(key, [mod]);
				}
			}

			// Read existing baselines from DB
			const baselinesOpt = yield* reader
				.getBaselines("__global__")
				.pipe(Effect.catchAll(() => Effect.succeed(Option.none<CoverageBaselines>())));
			const baselines = Option.getOrUndefined(baselinesOpt);

			// Process coverage via service
			// In multi-project mode (projectFilter set), only the reporter with the
			// most test modules processes coverage to avoid duplicate output.
			// Coverage is global -- it doesn't belong to any single project.
			const projectModuleCounts = new Map<string, number>();
			for (const m of modules) {
				const key = m.project.name || "default";
				projectModuleCounts.set(key, (projectModuleCounts.get(key) ?? 0) + 1);
			}
			const primaryProject = Array.from(projectModuleCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
			const isFirstProject = !opts.projectFilter || opts.projectFilter === primaryProject;
			const coverageOpts = {
				thresholds: opts.coverageThresholds,
				includeBareZero: opts.includeBareZero,
				...(opts.coverageTargets ? { targets: opts.coverageTargets } : {}),
				...(baselines ? { baselines } : {}),
			} as const;
			const coverageResult =
				stashedCoverage && isFirstProject ? yield* analyzer.process(stashedCoverage, coverageOpts) : Option.none();
			const coverageReport = Option.getOrUndefined(coverageResult);

			// Emit the coverage events. `onCoverage` only stashes the raw
			// istanbul map — the analyzed `CoverageReport` is the first
			// point at which the typed `CoverageReady` / `ThresholdViolation`
			// payloads can be populated, and it is ready here. A live
			// subscriber gets a coverage frame; without this the events are
			// defined and reduced but never published.
			if (wantsRunEvents && coverageReport !== undefined) {
				const globalThresholds = coverageReport.thresholds.global;
				emitEvent({
					_tag: "CoverageReady",
					metrics: coverageReport.totals,
					thresholds: globalThresholds,
					gaps: coverageReport.lowCoverage.map((fc) => ({
						file: fc.file,
						missing: fc.summary,
						uncoveredLines: fc.uncoveredLines,
					})),
				});
				for (const metric of ["lines", "branches", "functions", "statements"] as const) {
					const expected = globalThresholds[metric];
					const actual = coverageReport.totals[metric];
					if (expected !== undefined && actual < expected) {
						emitEvent({ _tag: "ThresholdViolation", metric, expected, actual });
					}
				}
			}

			// Build per-project reports
			// BUG FIX: Pass unhandledErrors to ALL projects, not just "default"
			const reports: AgentReport[] = [];
			// In multi-project mode (projectFilter set), always include project name
			const isMultiProject = projectGroups.size > 1 || !!opts.projectFilter;

			for (const [projectName, projectModules] of projectGroups) {
				const project = projectName === "default" ? "default" : projectName;

				const baseReport = buildAgentReport(
					projectModules,
					errors,
					reason,
					{ omitPassingTests: opts.omitPassingTests },
					isMultiProject ? projectName : undefined,
				);

				// Compute total duration for the run
				let totalDuration = 0;
				for (const mod of projectModules) {
					totalDuration += mod.diagnostic()?.duration ?? 0;
				}

				// Resolve attribution from process.env (canonical path —
				// SessionStart hook + PreToolUse Bash rewrite + run_tests
				// MCP env propagation all funnel into VITEST_AGENT_*).
				// Source 1: env vars present → actor_type='agent'.
				// Source 3: nothing set → actor_type='system' (CI/manual).
				const envAgentId = process.env.VITEST_AGENT_AGENT_ID;
				const envConversationId = process.env.VITEST_AGENT_CONVERSATION_ID;
				const attribution =
					envAgentId !== undefined && envAgentId.length > 0
						? {
								actorType: "agent" as const,
								agentId: envAgentId,
								conversationId: envConversationId ?? null,
							}
						: { actorType: "system" as const, agentId: null, conversationId: null };

				// Capture host metadata via the pure env-probe walk (terminal
				// pane, CI runner, etc). Git context is inherited from the
				// existing GITHUB_SHA / GITHUB_REF_NAME columns plus the new
				// per-run probes; full git context capture rides the future
				// RunContext service integration.
				const hostProbe = probeHostMetadataFromEnv(process.env);

				// Write test run to DB
				const runId = yield* store.writeRun({
					invocationId,
					project,
					settingsHash,
					timestamp: baseReport.timestamp,
					commitSha: process.env.GITHUB_SHA ?? null,
					branch: process.env.GITHUB_REF_NAME ?? null,
					reason,
					duration: totalDuration,
					total: baseReport.summary.total,
					passed: baseReport.summary.passed,
					failed: baseReport.summary.failed,
					skipped: baseReport.summary.skipped,
					scoped: false,
					actorType: attribution.actorType,
					agentId: attribution.agentId,
					conversationId: attribution.conversationId,
					gitBranch: process.env.GITHUB_REF_NAME ?? null,
					gitCommitSha: process.env.GITHUB_SHA ?? null,
					hostSource: hostProbe.source,
					hostValue: hostProbe.value,
					hostMetadata: hostProbe.metadata,
				});

				// Write modules and test cases to DB
				for (const mod of projectModules) {
					const fileId = yield* store.ensureFile(mod.relativeModuleId);

					const moduleIds = yield* store.writeModules(runId, [
						{
							fileId,
							relativeModuleId: mod.relativeModuleId,
							state: mod.state(),
							duration: mod.diagnostic()?.duration ?? 0,
						},
					]);
					const moduleId = moduleIds[0];

					// Write convention-based source-to-test mapping
					const sourceFile = mod.relativeModuleId.replace(/\.test\.([^.]+)$/, ".$1").replace(/\.spec\.([^.]+)$/, ".$1");
					if (sourceFile !== mod.relativeModuleId) {
						yield* store.writeSourceMap(sourceFile, moduleId, "convention");
					}

					// Write suites for this module, tracking IDs for parent relationships
					const suiteIdMap = new Map<string, number>();
					for (const suite of mod.children.allSuites()) {
						const parentSuiteId =
							suite.parent && suite.parent.type === "suite" ? suiteIdMap.get(suite.parent.fullName) : undefined;
						const suiteIds = yield* store.writeSuites(moduleId, [
							{
								name: suite.name,
								fullName: suite.fullName,
								state: suite.state(),
								...(parentSuiteId !== undefined && { parentSuiteId }),
								...(suite.options?.mode !== undefined && { mode: suite.options.mode }),
								...(suite.options?.concurrent !== undefined && { concurrent: suite.options.concurrent }),
								...(suite.options?.shuffle !== undefined && { shuffle: suite.options.shuffle }),
								...(suite.options?.retry !== undefined && { retry: suite.options.retry }),
								...(suite.options?.repeats !== undefined && { repeats: suite.options.repeats }),
								...(suite.location?.line !== undefined && { locationLine: suite.location.line }),
								...(suite.location?.column !== undefined && { locationColumn: suite.location.column }),
							} as Parameters<typeof store.writeSuites>[1][number],
						]);
						suiteIdMap.set(suite.fullName, suiteIds[0]);
					}

					// Collect test cases for this module, capturing the parent suite id
					// so listSuites can count tests per suite via test_cases.suite_id.
					const testCases: Array<{
						name: string;
						fullName: string;
						state: string;
						duration?: number;
						flaky?: boolean;
						slow?: boolean;
						tags?: readonly string[];
						suiteId?: number;
					}> = [];
					for (const testCase of mod.children.allTests()) {
						const result = testCase.result();
						const diag = testCase.diagnostic();
						const parent = testCase.parent;
						const parentSuiteId = parent && parent.type === "suite" ? suiteIdMap.get(parent.fullName) : undefined;
						testCases.push({
							name: testCase.name,
							fullName: testCase.fullName,
							state: result?.state ?? "pending",
							...(diag?.duration !== undefined && { duration: diag.duration }),
							...(diag?.flaky !== undefined && { flaky: diag.flaky }),
							...(diag?.slow !== undefined && { slow: diag.slow }),
							...(testCase.tags.length > 0 && { tags: testCase.tags }),
							...(parentSuiteId !== undefined && { suiteId: parentSuiteId }),
						});
					}

					const testCaseIds = yield* store.writeTestCases(
						moduleId,
						testCases.map((tc) => ({
							name: tc.name,
							fullName: tc.fullName,
							state: tc.state,
							...(tc.duration !== undefined && { duration: tc.duration }),
							...(tc.flaky !== undefined && { flaky: tc.flaky }),
							...(tc.slow !== undefined && { slow: tc.slow }),
							...(tc.tags !== undefined && { tags: tc.tags }),
							...(tc.suiteId !== undefined && { suiteId: tc.suiteId }),
						})),
					);

					// Write test errors for this module's test cases
					// Re-iterate tests to get errors (we need the IDs from writeTestCases)
					let testIdx = 0;
					for (const testCase of mod.children.allTests()) {
						const result = testCase.result();
						if (result?.errors && result.errors.length > 0) {
							const testCaseId = testCaseIds[testIdx];
							const inputs: TestErrorInput[] = [];
							for (let ordinal = 0; ordinal < result.errors.length; ordinal++) {
								const e = result.errors[ordinal] as {
									name?: string;
									message: string;
									diff?: string;
									stack?: string;
									stacks?: ReadonlyArray<{ file?: string; line?: number; column?: number; method?: string }>;
								};
								const { frames, signatureHash } = processFailure(e);
								if (signatureHash !== null) {
									yield* store.writeFailureSignature({
										signatureHash,
										runId,
										seenAt: baseReport.timestamp,
									});
								}
								inputs.push({
									testCaseId,
									scope: "test" as const,
									message: e.message,
									...(e.name !== undefined && { name: e.name }),
									...(e.diff !== undefined && { diff: e.diff }),
									...(e.stack !== undefined && { stack: e.stack }),
									...(signatureHash !== null && { signatureHash }),
									...(frames.length > 0 && { frames }),
									ordinal,
								});
							}
							yield* store.writeErrors(runId, inputs);
						}
						testIdx++;
					}

					// Write module-level errors
					const modErrors = mod.errors();
					if (modErrors.length > 0) {
						const inputs: TestErrorInput[] = [];
						for (let ordinal = 0; ordinal < modErrors.length; ordinal++) {
							const e = modErrors[ordinal] as {
								name?: string;
								message: string;
								stack?: string;
								stacks?: ReadonlyArray<{ file?: string; line?: number; column?: number; method?: string }>;
							};
							const { frames, signatureHash } = processFailure(e);
							if (signatureHash !== null) {
								yield* store.writeFailureSignature({
									signatureHash,
									runId,
									seenAt: baseReport.timestamp,
								});
							}
							inputs.push({
								moduleId,
								scope: "module" as const,
								message: e.message,
								...(e.name !== undefined && { name: e.name }),
								...(e.stack !== undefined && { stack: e.stack }),
								...(signatureHash !== null && { signatureHash }),
								...(frames.length > 0 && { frames }),
								ordinal,
							});
						}
						yield* store.writeErrors(runId, inputs);
					}
				}

				// Write unhandled errors
				if (errors.length > 0) {
					const inputs: TestErrorInput[] = [];
					for (let ordinal = 0; ordinal < errors.length; ordinal++) {
						const e = errors[ordinal] as {
							name?: string;
							message: string;
							stack?: string;
							stacks?: ReadonlyArray<{ file?: string; line?: number; column?: number; method?: string }>;
						};
						const { frames, signatureHash } = processFailure(e);
						if (signatureHash !== null) {
							yield* store.writeFailureSignature({
								signatureHash,
								runId,
								seenAt: baseReport.timestamp,
							});
						}
						inputs.push({
							scope: "unhandled" as const,
							message: e.message,
							...(e.name !== undefined && { name: e.name }),
							...(e.stack !== undefined && { stack: e.stack }),
							...(signatureHash !== null && { signatureHash }),
							...(frames.length > 0 && { frames }),
							ordinal,
						});
					}
					yield* store.writeErrors(runId, inputs);
				}

				// Extract test outcomes for history classification
				const testOutcomes: TestOutcome[] = [];
				for (const mod of projectModules) {
					for (const testCase of mod.children.allTests()) {
						const state = testCase.result()?.state;
						if (state === "passed" || state === "failed") {
							testOutcomes.push({ fullName: testCase.fullName, state });
						}
					}
				}

				// Classify tests via history and attach classifications to failed test reports
				const { classifications } = yield* tracker.classify(project, testOutcomes, baseReport.timestamp);

				// Build lookup maps for diagnostics and errors (avoids O(N²) nested loops)
				const diagMap = new Map<string, { duration?: number; flaky?: boolean }>();
				const errorMap = new Map<string, string | null>();
				for (const mod of projectModules) {
					for (const tc of mod.children.allTests()) {
						diagMap.set(tc.fullName, tc.diagnostic() ?? {});
						const tcResult = tc.result();
						if (tcResult?.state === "failed") {
							const errors = tcResult.errors;
							errorMap.set(tc.fullName, errors?.[0]?.message ?? null);
						}
					}
				}

				// Write individual history entries to DB
				for (const outcome of testOutcomes) {
					const diag = diagMap.get(outcome.fullName);
					const errorMessage = outcome.state === "failed" ? (errorMap.get(outcome.fullName) ?? null) : null;

					yield* store.writeHistory(
						project,
						outcome.fullName,
						runId,
						baseReport.timestamp,
						outcome.state,
						diag?.duration ?? null,
						diag?.flaky ?? false,
						0,
						errorMessage,
					);
				}

				// Schema types are readonly -- rebuild failed array with classifications applied
				const failedWithClassifications = baseReport.failed.map((mod) => ({
					...mod,
					tests: mod.tests.map((test) => {
						const cls = classifications.get(test.fullName);
						return cls ? { ...test, classification: cls } : test;
					}),
				}));
				const classifiedReport: AgentReport = { ...baseReport, failed: failedWithClassifications };

				// Aggregate per-tag pass/fail/skip counts for this project
				const tagCounts: Record<string, { passed: number; failed: number; skipped: number }> = {};
				for (const mod of projectModules) {
					for (const tc of mod.children.allTests()) {
						const state = tc.result()?.state ?? "pending";
						const tags = tc.tags ?? [];
						for (const tag of tags) {
							tagCounts[tag] ??= { passed: 0, failed: 0, skipped: 0 };
							if (state === "passed") tagCounts[tag].passed++;
							else if (state === "failed") tagCounts[tag].failed++;
							else if (state === "skipped") tagCounts[tag].skipped++;
						}
					}
				}
				const reportWithTags: AgentReport =
					Object.keys(tagCounts).length > 0 ? { ...classifiedReport, tagCounts } : classifiedReport;

				// NOTE: Coverage is global, not per-project. In monorepos, each project
				// report receives the same coverage data. Per-project filtering would
				// require path-based heuristics. See architecture doc "Trade-off:
				// Coverage Not Per-Project".
				const report: AgentReport = coverageReport ? { ...reportWithTags, coverage: coverageReport } : reportWithTags;

				reports.push(report);

				// Write coverage data to DB. Two tiers persisted:
				//
				// - lowCoverage entries are failures against the minimum
				//   threshold (build-blocking).
				// - belowTarget entries are warnings: above threshold but
				//   below the aspirational target.
				//
				// The two sets can overlap when the build is failing.
				// Dedupe on file path so each file produces a single row;
				// tier resolves to "below_threshold" whenever a file is in
				// lowCoverage (the more severe classification wins).
				if (coverageReport) {
					const tierByFile = new Map<string, "below_threshold" | "below_target">();
					const sourceByFile = new Map<string, (typeof coverageReport.lowCoverage)[number]>();
					for (const fc of coverageReport.belowTarget ?? []) {
						tierByFile.set(fc.file, "below_target");
						sourceByFile.set(fc.file, fc);
					}
					for (const fc of coverageReport.lowCoverage) {
						tierByFile.set(fc.file, "below_threshold");
						sourceByFile.set(fc.file, fc);
					}
					if (tierByFile.size > 0) {
						const coverageInputs = [];
						for (const [file, tier] of tierByFile) {
							const fc = sourceByFile.get(file);
							if (!fc) continue;
							const fileId = yield* store.ensureFile(fc.file);
							coverageInputs.push({
								fileId,
								statements: fc.summary.statements,
								branches: fc.summary.branches,
								functions: fc.summary.functions,
								lines: fc.summary.lines,
								uncoveredLines: fc.uncoveredLines,
								tier,
							});
						}
						yield* store.writeCoverage(runId, coverageInputs);
					}
				}

				// Record coverage trend (full runs only)
				if (coverageReport && !coverageReport.scoped) {
					const existingTrends = yield* reader.getTrends(project).pipe(
						Effect.map((opt) => Option.getOrUndefined(opt)),
						Effect.catchAll(() => Effect.succeed(undefined)),
					);
					const updatedTrends = computeTrend(coverageReport.totals, existingTrends, opts.coverageTargets);
					// Write the latest trend entry
					const latestEntry = updatedTrends.entries[updatedTrends.entries.length - 1];
					if (latestEntry) {
						yield* store.writeTrends(project, runId, latestEntry);
					}
				}
			}

			// Write updated baselines if autoUpdate is enabled and coverage was processed
			if (opts.autoUpdate && coverageReport) {
				const newBaselines = computeUpdatedBaselines(baselines, coverageReport.totals, opts.coverageTargets);
				yield* store.writeBaselines(newBaselines);
			}

			// Build trend summary for output context (read back after writing)
			let trendSummary:
				| {
						direction: "improving" | "regressing" | "stable";
						runCount: number;
						firstMetric?: { name: string; from: number; to: number; target?: number };
				  }
				| undefined;
			if (coverageReport && !coverageReport.scoped) {
				const firstProjectKey = Array.from(projectGroups.keys())[0];
				if (firstProjectKey) {
					const tp = firstProjectKey === "default" ? "default" : firstProjectKey;
					const trendsOpt = yield* reader.getTrends(tp).pipe(Effect.catchAll(() => Effect.succeed(Option.none())));
					if (Option.isSome(trendsOpt)) {
						const entries = trendsOpt.value.entries;
						if (entries.length >= 2) {
							const latest = entries[entries.length - 1];
							const prev = entries[entries.length - 2];
							const direction = latest.direction as "improving" | "regressing" | "stable";
							const metrics = ["lines", "functions", "branches", "statements"] as const;
							let firstMetric: { name: string; from: number; to: number; target?: number } | undefined;
							for (const m of metrics) {
								const from = prev.coverage[m];
								const to = latest.coverage[m];
								if (from !== to) {
									const target = opts.coverageTargets?.global?.[m];
									firstMetric = { name: m, from, to, ...(target !== undefined ? { target } : {}) };
									break;
								}
							}
							trendSummary = { direction, runCount: entries.length, ...(firstMetric ? { firstMetric } : {}) };
						}
					}
				}
			}

			if (wantsRunEvents && trendSummary !== undefined) {
				emitEvent({
					_tag: "TrendComputed",
					direction: trendSummary.direction,
					runCount: trendSummary.runCount,
				});
			}

			yield* Effect.logInfo("reports built").pipe(
				Effect.annotateLogs({ count: reports.length, projects: Array.from(projectGroups.keys()).join(", ") }),
			);

			// Resolve env / executor / format / detail via the pipeline services
			// (not the renderer — rendering is delegated to the user's reporter).
			const detector = yield* EnvironmentDetector;
			const executorResolver = yield* ExecutorResolver;
			const formatSelector = yield* FormatSelector;
			const detailResolver = yield* DetailResolver;

			const env = yield* detector.detect();
			const executor = yield* executorResolver.resolve(env);
			const format = yield* formatSelector.select(executor, opts.format, env);
			const health = {
				hasFailures: reports.some((r) => r.summary.failed > 0 || r.unhandledErrors.length > 0),
				belowTargets: reports.some((r) => {
					const cov = r.coverage as { belowTarget?: unknown[] } | undefined;
					return (cov?.belowTarget?.length ?? 0) > 0;
				}),
				hasTargets: !!opts.coverageTargets,
			};
			const detail = yield* detailResolver.resolve(executor, health, opts.detail);

			yield* Effect.logDebug("pipeline resolved").pipe(Effect.annotateLogs({ env, executor, format, detail }));

			// Aggregate classifications into a flat lookup for the user reporter.
			// Reports already carry classification on each test object; this
			// Map gives reporters a global view without traversing reports.
			const classifications = new Map<string, TestClassification>();
			for (const report of reports) {
				for (const mod of report.failed) {
					for (const test of mod.tests) {
						if (test.classification) classifications.set(test.fullName, test.classification);
					}
				}
			}

			// Build the render kit and resolve the user's reporter(s).
			const githubSummaryFile = process.env.GITHUB_STEP_SUMMARY;
			const kit = buildReporterKit({
				env,
				executor,
				format,
				detail,
				noColor: !!process.env.NO_COLOR,
				consoleMode: opts.consoleMode ?? "passthrough",
				mcp: opts.mcp ?? false,
				githubActions: opts.githubActions,
				transport: opts.transport,
				runEvents,
				...(dbPath !== undefined && { dbPath }),
				...(opts.projectFilter !== undefined && { projectFilter: opts.projectFilter }),
				...(opts.coverageThresholds !== undefined && { coverageThresholds: opts.coverageThresholds }),
				...(opts.coverageTargets !== undefined && { coverageTargets: opts.coverageTargets }),
				...(opts.passWithNoTests !== undefined && { passWithNoTests: opts.passWithNoTests }),
				coverageMode: opts.coverageMode,
			});

			// Reuse the reporters resolved at run start; resolve the factory
			// here only when onInit did not run. This health-aware render kit
			// is the one handed to `render`.
			const reporters = preBuiltReporters ?? normalizeReporters(opts.reporter(kit));
			const renderInput = {
				reports,
				classifications,
				...(trendSummary !== undefined && { trendSummary }),
			};

			// Concatenate outputs from every user reporter, then route each.
			const allOutputs = reporters.flatMap((r) => r.render(renderInput, kit));
			yield* Effect.logDebug("reporters rendered").pipe(
				Effect.annotateLogs({ reporterCount: reporters.length, outputs: allOutputs.length }),
			);
			for (const output of allOutputs) {
				routeRenderedOutput(output, {
					...(githubSummaryFile !== undefined && { githubSummaryFile }),
				});
			}
		});

		await Effect.runPromise(
			program.pipe(Effect.annotateLogs("service", "reporter"), Effect.provide(ReporterLive(dbPath, logLevel, logFile))),
		).catch((err) => {
			process.stderr.write(`vitest-agent: ${formatFatalError(err)}\n`);
		});
	}
}
