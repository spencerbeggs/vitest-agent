/**
 * vitest-agent-plugin
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
import type { LogLevel } from "effect";
import { Effect, Option } from "effect";
import { defaultReporter } from "vitest-agent-reporter";
import type {
	AgentReport,
	AgentReporterOptions,
	CoverageBaselines,
	ResolvedThresholds,
	TestClassification,
	TestErrorInput,
	TestOutcome,
	VitestAgentReporterFactory,
	VitestTestModule,
} from "vitest-agent-sdk";
import {
	DataReader,
	DataStore,
	DetailResolver,
	EnvironmentDetector,
	ExecutorResolver,
	FormatSelector,
	HistoryTracker,
	PathResolutionLive,
	buildAgentReport,
	computeTrend,
	ensureMigrated,
	formatFatalError,
	resolveDataPath,
	resolveLogFile,
	resolveLogLevel,
} from "vitest-agent-sdk";
import { ReporterLive } from "./layers/ReporterLive.js";
import { CoverageAnalyzer } from "./services/CoverageAnalyzer.js";
import { buildReporterKit, normalizeReporters } from "./utils/build-reporter-kit.js";
import { captureEnvVars } from "./utils/capture-env.js";
import { captureSettings, hashSettings } from "./utils/capture-settings.js";
import { processFailure } from "./utils/process-failure.js";
import { resolveThresholds } from "./utils/resolve-thresholds.js";
import { routeRenderedOutput } from "./utils/route-rendered-output.js";

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
	githubActions: boolean | undefined;
	githubSummaryFile: string | undefined;
	format?: "terminal" | "markdown" | "json" | "vitest-bypass" | "silent" | "ci-annotations";
	detail?: "minimal" | "neutral" | "standard" | "verbose";
	mode?: "auto" | "agent" | "silent";
	logLevel?: LogLevel.LogLevel;
	logFile?: string;
	mcp?: boolean;
	projectFilter?: string;
	reporter: VitestAgentReporterFactory;
}

/**
 * Constructor argument shape for {@link AgentReporter}. Extends the
 * schema-defined {@link AgentReporterOptions} with the `reporter` factory
 * (a function — schema can't easily encode functions, so it's not part of
 * the published Effect Schema).
 */
export interface AgentReporterConstructorOptions extends AgentReporterOptions {
	reporter?: VitestAgentReporterFactory;
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
 * import { AgentReporter } from "vitest-agent-plugin";
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

	constructor(options: AgentReporterConstructorOptions = {}) {
		this.logLevel = resolveLogLevel(options.logLevel);
		this.logFile = resolveLogFile(options.logFile);

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

		const resolvedFormat = options.format ?? (options.consoleOutput === "silent" ? "silent" : undefined);
		const base: ResolvedOptions = {
			...(options.cacheDir !== undefined ? { cacheDir: options.cacheDir } : {}),
			consoleOutput: options.consoleOutput ?? "failures",
			omitPassingTests: options.omitPassingTests ?? true,
			coverageThresholds: resolvedThresholds,
			autoUpdate: options.autoUpdate ?? true,
			coverageConsoleLimit: options.coverageConsoleLimit ?? 10,
			includeBareZero: options.includeBareZero ?? false,
			githubActions: options.githubActions,
			githubSummaryFile: options.githubSummaryFile,
			...(resolvedFormat !== undefined ? { format: resolvedFormat } : {}),
			...(options.detail !== undefined ? { detail: options.detail } : {}),
			...(options.mode !== undefined ? { mode: options.mode } : {}),
			...(options.mcp !== undefined ? { mcp: options.mcp } : {}),
			...(options.projectFilter !== undefined ? { projectFilter: options.projectFilter } : {}),
			reporter: options.reporter ?? defaultReporter,
		};
		this.options = resolvedTargets ? { ...base, coverageTargets: resolvedTargets } : base;
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

		const modules = testModules as ReadonlyArray<VitestTestModule>;
		const errors = unhandledErrors as ReadonlyArray<{ message: string; stack?: string }>;

		// Capture options for use inside Effect.gen
		const opts = this.options;
		const stashedCoverage = this.coverage;
		const stashedVitest = this._vitest;
		const logLevel = this.logLevel;
		const logFile = this.logFile;

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
			const executor = yield* executorResolver.resolve(env, opts.mode ?? "auto");
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

			// Build the kit and resolve the user's reporter(s).
			const githubSummaryFile = opts.githubSummaryFile ?? process.env.GITHUB_STEP_SUMMARY;
			const kit = buildReporterKit({
				env,
				executor,
				format,
				detail,
				noColor: !!process.env.NO_COLOR,
				mode: opts.mode ?? "auto",
				mcp: opts.mcp ?? false,
				consoleOutput: opts.consoleOutput,
				omitPassingTests: opts.omitPassingTests,
				coverageConsoleLimit: opts.coverageConsoleLimit,
				includeBareZero: opts.includeBareZero,
				githubActions: opts.githubActions ?? env === "ci-github",
				...(dbPath !== undefined && { dbPath }),
				...(opts.projectFilter !== undefined && { projectFilter: opts.projectFilter }),
				...(githubSummaryFile !== undefined && { githubSummaryFile }),
				...(opts.coverageThresholds !== undefined && { coverageThresholds: opts.coverageThresholds }),
				...(opts.coverageTargets !== undefined && { coverageTargets: opts.coverageTargets }),
			});

			const reporters = normalizeReporters(opts.reporter(kit));
			const renderInput = {
				reports,
				classifications,
				...(trendSummary !== undefined && { trendSummary }),
			};

			// Concatenate outputs from every user reporter, then route each.
			const allOutputs = reporters.flatMap((r) => r.render(renderInput));
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
