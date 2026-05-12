/**
 * vitest-agent-plugin
 *
 * {@link AgentPlugin} convenience wrapper that injects {@link AgentReporter}
 * into the Vitest reporter chain via the `configureVitest` hook (Vitest 3.1+).
 *
 * @packageDocumentation
 */

import { execSync } from "node:child_process";
import type { TestTagDefinition } from "@vitest/runner";
import type { Layer } from "effect";
import { Effect } from "effect";
import type { TestProjectInlineConfiguration } from "vitest/config";
import type { VitestPluginContext } from "vitest/node";
import type {
	AgentConsoleMode,
	AgentPluginOptions,
	CiConsoleMode,
	ConsoleMode,
	CoverageInput,
	CoverageLevelName,
	Environment,
	Executor,
	HumanConsoleMode,
	OutputFormat,
	VitestAgentReporterFactory,
} from "vitest-agent-sdk";
import {
	CoverageLevel,
	EnvironmentDetector,
	EnvironmentDetectorLive,
	formatFatalError,
	resolveCoverageInput,
	resolveLogLevel,
	validateCoverageConfig,
} from "vitest-agent-sdk";
import { AgentReporter } from "./reporter.js";
import { buildModuleInfo } from "./utils/build-module-info.js";
import type { DiscoveryOptions } from "./utils/discover-projects.js";
import { discoverProjects } from "./utils/discover-projects.js";
import type { InjectTagsResult } from "./utils/inject-tags.js";
import { injectTags } from "./utils/inject-tags.js";
import { resolveThresholds } from "./utils/resolve-thresholds.js";
import { stripConsoleReporters } from "./utils/strip-console-reporters.js";
import { TagStrategy } from "./utils/tag-strategy.js";

/**
 * Plugin options shape with the (function-typed) `reporter` factory added
 * on top of the schema-defined {@link AgentPluginOptions}. Schema can't
 * easily encode functions, so the factory lives outside the published
 * Effect Schema.
 */
export interface AgentPluginConstructorOptions extends AgentPluginOptions {
	/**
	 * Factory that builds the reporter(s) the plugin will dispatch to.
	 * Defaults to the built-in `defaultReporter` from this package.
	 *
	 * Returning an array of reporters is supported: each is called once per
	 * run and their `RenderedOutput[]` results are concatenated and routed.
	 *
	 * Pass a factory function to swap out the default rendering pipeline:
	 * ```ts
	 * agentPlugin({ reporter: () => myReporter })
	 * ```
	 */
	reporter?: VitestAgentReporterFactory;
	/**
	 * Optional live event tap. The plugin forwards every per-test and
	 * per-module {@link RunEvent} to this callback as the test run
	 * progresses. Hosts drive a live renderer (Ink, debug logging) from
	 * here. Throwing taps are caught and logged to stderr.
	 */
	onRunEvent?: (event: import("vitest-agent-sdk").RunEvent) => void;
	coverageThresholds?: CoverageInput;
	coverageTargets?: CoverageInput;
	/**
	 * Controls the Vite transform hook that rewrites test() and it() call
	 * options to inject filename-derived tags. Pass a TagStrategy instance
	 * to customize classification, or false to disable the transform entirely.
	 *
	 * Defaults to TagStrategy.default (unit / int / e2e by filename suffix).
	 */
	tagStrategy?: TagStrategy | false;
}

/**
 * Resolve which {@link ConsoleMode} value applies to the active executor.
 * Looks up `console.{executor}` in the user-supplied matrix, falls back to
 * the per-slot default.
 *
 * Per-slot defaults:
 * - `human` → `passthrough` (Vitest's own reporters do the visible work).
 *   Users opt into `ink` for live animation by setting it explicitly and
 *   wiring `createLiveInk` via `onRunEvent`.
 * - `agent` → `agent` (markdown-flavored final-frame string).
 * - `ci` → `passthrough` (Vitest's reporters produce log-friendly output;
 *   the dedicated `ci-annotations` reporter is opt-in until the GHA
 *   annotations writer ships).
 *
 * @internal
 */
function resolveConsoleMode(options: AgentPluginOptions, executor: Executor, _env: Environment): ConsoleMode {
	const console = options.console;
	if (executor === "human") {
		return (console?.human as HumanConsoleMode | undefined) ?? "passthrough";
	}
	if (executor === "agent") {
		return (console?.agent as AgentConsoleMode | undefined) ?? "agent";
	}
	return (console?.ci as CiConsoleMode | undefined) ?? "passthrough";
}

/**
 * The plugin owns stdout when the resolved console mode produces visible
 * output that would conflict with Vitest's own reporters. Passthrough lets
 * Vitest emit progress normally; silent strips everything; the other modes
 * (ink, agent, ci-annotations) need exclusive stdout access.
 *
 * @internal
 */
function ownsStdout(mode: ConsoleMode): boolean {
	return mode !== "passthrough";
}

/**
 * Map the resolved {@link ConsoleMode} to the legacy {@link OutputFormat}
 * the existing reporter factories switch on. The new event-sourced renderer
 * does not consult this — it dispatches directly on `kit.config.consoleMode`
 * — but the bundled markdown/terminal/silent/ci-annotations reporters still
 * need a format value to pick which formatter to invoke.
 *
 * @internal
 */
function resolveFormat(mode: ConsoleMode, explicit?: OutputFormat): OutputFormat {
	if (explicit) return explicit;
	switch (mode) {
		case "ink":
		case "agent":
			return "terminal";
		case "ci-annotations":
			return "ci-annotations";
		case "silent":
			return "silent";
		case "passthrough":
			return "vitest-bypass";
	}
}

/**
 * Vitest plugin that injects {@link AgentReporter} into the reporter chain.
 *
 * @param options - Plugin configuration options
 * @param _layer - Internal: override the EnvironmentDetector layer (for testing)
 * @returns Vitest plugin object with `configureVitest` hook
 *
 * @public
 */
/**
 * Set to the Vitest object reference once we've pushed an aggregating
 * reporter for that Vitest instance. The flag is module-scoped (rather
 * than closure-scoped on the plugin) because Vitest can construct the
 * plugin more than once per `vitest run` invocation (e.g., once per
 * project). Keying the guard on the Vitest reference itself ensures we
 * push exactly one reporter per actual Vitest run, regardless of how
 * many times the plugin or `configureVitest` fires.
 *
 * The terminal/markdown formatters render all projects in one block
 * (Projects header, per-project rows, one Total at the bottom), so we
 * want exactly ONE reporter instance handling the whole run rather than
 * N reporters each rendering their own slice.
 *
 * @internal
 */
const aggregatedReporterByVitest = new WeakSet<object>();

const TEST_FILE_SUFFIX_RE = /\.(?:test|spec)\.(?:ts|tsx|js|jsx)$/;
const TEST_FILE_DIR_RE = /\/(?:src|__test__)\//;
const isTestFile = (id: string): boolean => TEST_FILE_SUFFIX_RE.test(id) && TEST_FILE_DIR_RE.test(id);

/**
 * Map a detected {@link Environment} to its {@link Executor}. Inline copy
 * of the `ExecutorResolverLive` mapping so the plugin can compute it
 * synchronously inside `configureVitest` without spinning up an Effect
 * runtime.
 *
 * @internal
 */
function envToExecutor(env: Environment): Executor {
	if (env === "agent-shell") return "agent";
	if (env === "terminal") return "human";
	return "ci";
}

export function AgentPlugin(options: AgentPluginConstructorOptions = {}, _layer?: Layer.Layer<EnvironmentDetector>) {
	const mcp = options.mcp ?? false;
	const layer = _layer ?? EnvironmentDetectorLive;

	// Resolve log level for local debug logging in the plugin.
	// The plugin runs outside an Effect program, so we use a simple stderr function.
	// logLevel/logFile options are passed through to AgentReporter for Effect logging.
	const logLevel = resolveLogLevel(options.logLevel);
	const shouldLog = logLevel !== undefined && logLevel._tag !== "None";
	const log = shouldLog
		? (...args: unknown[]) => process.stderr.write(`[vitest-agent:plugin] ${args.map(String).join(" ")}\n`)
		: (..._args: unknown[]) => {};

	const tagStrategyResolved = options.tagStrategy === false ? null : (options.tagStrategy ?? TagStrategy.default);

	const pluginObj: {
		name: "vitest-agent";
		configureVitest(ctx: VitestPluginContext): Promise<void>;
		transform?: (code: string, id: string) => InjectTagsResult | null;
	} = {
		name: "vitest-agent",

		async configureVitest(ctx: VitestPluginContext) {
			try {
				const { vitest, project } = ctx;
				log("configureVitest called | project:", project?.name ?? "(root)");

				// Auto-detect the environment, then map to the executor slot.
				const env: Environment = await Effect.runPromise(
					Effect.provide(
						Effect.flatMap(EnvironmentDetector, (d) => d.detect()),
						layer,
					),
				);
				const executor = envToExecutor(env);
				const consoleMode = resolveConsoleMode(options, executor, env);
				const format = resolveFormat(consoleMode, options.format);
				log("env:", env, "| executor:", executor, "| consoleMode:", consoleMode, "| format:", format);

				// Strip Vitest's own reporters whenever the plugin owns stdout.
				// Passthrough leaves the chain intact so Vitest's reporters run
				// normally; the plugin contributes only persistence-driven side
				// channels (DB writes, MCP tool surface).
				if (ownsStdout(consoleMode)) {
					log("stripping console reporters (consoleMode owns stdout)");
					const stripped = stripConsoleReporters(vitest.config.reporters as unknown[]);
					(vitest.config as { reporters: unknown[] }).reporters = stripped;

					// Suppress Vitest's native coverage text reporter — the plugin
					// owns coverage output too whenever it owns stdout.
					const coverageCfg = vitest.config.coverage as { reporter?: unknown[] } | undefined;
					if (coverageCfg) {
						log("suppressing native coverage text reporter");
						coverageCfg.reporter = [];
					}
				}

				// GitHub Actions step summary is independent of the console
				// mode. Default on under GHA; user can disable via githubSummary.
				const githubActions = options.githubSummary ?? (env === "ci-github" && consoleMode !== "silent");
				log("githubActions (step-summary):", githubActions);

				// Resolve cache directory override with priority:
				// 1. Explicit reporter.cacheDir option
				// 2. outputFile['vitest-agent'] from vitest config (Vitest-native)
				// When unset, the reporter falls back to XDG-based resolution via
				// resolveDataPath (workspace name under $XDG_DATA_HOME).
				const outputFile = (vitest.config as { outputFile?: string | Record<string, string> }).outputFile;
				const cacheDir = options.reporterOptions?.cacheDir ?? resolveOutputDir(outputFile) ?? undefined;

				// Resolve coverage thresholds: plugin options take priority; fall back to Vitest native config
				const coverageConfig = vitest.config.coverage as { thresholds?: Record<string, unknown> } | undefined;
				const vitestNativeThresholds = coverageConfig?.thresholds
					? resolveThresholds(coverageConfig.thresholds as Record<string, unknown>)
					: undefined;

				const resolvedThresholds = resolveCoverageInput(
					options.coverageThresholds as CoverageInput | undefined,
					"none",
				);
				const resolvedTargets = options.coverageTargets
					? resolveCoverageInput(options.coverageTargets as CoverageInput, "standard")
					: undefined;

				// Only validate when targets are explicitly set
				if (resolvedTargets) {
					validateCoverageConfig(resolvedThresholds, resolvedTargets);
				}

				// Adapt CoverageLevel to the internal ResolvedThresholds format for AgentReporter
				const coverageThresholds =
					vitestNativeThresholds && !options.coverageThresholds
						? vitestNativeThresholds
						: {
								global: {
									lines: resolvedThresholds.lines,
									functions: resolvedThresholds.functions,
									branches: resolvedThresholds.branches,
									statements: resolvedThresholds.statements,
								},
								perFile: resolvedThresholds.perFile ?? false,
								patterns: [],
							};

				// Only build the coverageTargets object when the user explicitly opted in
				const coverageTargets = resolvedTargets
					? {
							global: {
								lines: resolvedTargets.lines,
								functions: resolvedTargets.functions,
								branches: resolvedTargets.branches,
								statements: resolvedTargets.statements,
							},
							perFile: resolvedTargets.perFile ?? false,
							patterns: [],
						}
					: undefined;
				const autoUpdate = options.reporterOptions?.autoUpdate ?? true;

				// Disable Vitest's native autoUpdate when our targets are set
				if (coverageTargets && autoUpdate) {
					const thresholds = coverageConfig?.thresholds;
					if (thresholds && typeof thresholds === "object") {
						(thresholds as Record<string, unknown>).autoUpdate = false;
					}
				}

				log("cacheDir:", cacheDir ?? "(XDG default)");

				// Push exactly one aggregating reporter per Vitest run. The
				// terminal/markdown formatters render all projects in one block
				// (Projects header + per-project rows + one Total), so a single
				// reporter handling all projects produces the right output. Per-
				// project calls after the first one still apply project-scoped
				// config (reporter stripping, native-coverage suppression) but
				// don't push another reporter.
				if (aggregatedReporterByVitest.has(vitest as object)) {
					log(
						"aggregate reporter already pushed for this Vitest run; skipping push for project:",
						project?.name ?? "(root)",
					);
					return;
				}

				const reporter = new AgentReporter({
					...options.reporterOptions,
					...(cacheDir !== undefined ? { cacheDir } : {}),
					coverageThresholds,
					coverageTargets,
					autoUpdate,
					format,
					consoleMode,
					logLevel: options.logLevel,
					logFile: options.logFile,
					mcp,
					githubActions,
					githubSummary: githubActions,
					...(options.reporter !== undefined && { reporter: options.reporter }),
					// onRunEvent powers the live renderer. Only forward it when
					// the resolved consoleMode is "ink" — every other mode either
					// renders statically (agent, ci-annotations) or asked for
					// silence (passthrough lets Vitest render, silent strips
					// everything). Forwarding the tap regardless leaks a live
					// Ink mount into modes the user explicitly opted out of.
					...(options.onRunEvent !== undefined && consoleMode === "ink" ? { onRunEvent: options.onRunEvent } : {}),
				});

				// Push reporter into the config (mutating the reporters array)
				(vitest.config.reporters as unknown[]).push(reporter);
				aggregatedReporterByVitest.add(vitest as object);

				log("reporters after push:", vitest.config.reporters.length);
			} catch (err) {
				process.stderr.write(`vitest-agent: ${formatFatalError(err)}\n`);
				throw err;
			}
		},
	};

	if (tagStrategyResolved) {
		pluginObj.transform = (code, id) => {
			const cleanId = id.split("?")[0]!;
			if (!isTestFile(cleanId)) return null;
			const module = buildModuleInfo(cleanId);
			const tags = tagStrategyResolved.classify({ module });
			if (tags.length === 0) return null;
			const rewritten = injectTags(code, [...tags]);
			if (rewritten === null) return null;
			return rewritten;
		};
	}

	return pluginObj;
}

export namespace AgentPlugin {
	export const COVERAGE_LEVELS: Readonly<Record<CoverageLevelName, CoverageLevel>> = Object.freeze({
		none: CoverageLevel.none,
		basic: CoverageLevel.basic,
		standard: CoverageLevel.standard,
		strict: CoverageLevel.strict,
		full: CoverageLevel.full,
	});

	export const COVERAGE_LEVELS_PER_FILE: Readonly<Record<CoverageLevelName, CoverageLevel>> = Object.freeze({
		none: CoverageLevel.none.withPerFile(),
		basic: CoverageLevel.basic.withPerFile(),
		standard: CoverageLevel.standard.withPerFile(),
		strict: CoverageLevel.strict.withPerFile(),
		full: CoverageLevel.full.withPerFile(),
	});

	/**
	 * Discover Vitest project configs and tag definitions from the workspace layout.
	 *
	 * Use with an async config export so projects are resolved before Vitest
	 * reads the config:
	 *
	 * ```ts
	 * export default defineConfig(async () => {
	 *   const { projects, tags } = await AgentPlugin.discover();
	 *   return { plugins: [AgentPlugin()], test: { projects, tags } };
	 * });
	 * ```
	 */
	export async function discover(
		options?: DiscoveryOptions,
	): Promise<{ projects: TestProjectInlineConfiguration[]; tags: TestTagDefinition[] }> {
		const { projects, tags } = await discoverProjects(options);
		return { projects: projects.map((p) => p.toConfig()), tags };
	}

	/**
	 * Run a shell command, suppressing all output unless the command fails.
	 * Designed for use in Vitest `globalSetup` files to run build steps or
	 * other preparatory scripts without polluting agent stdout.
	 *
	 * On failure the captured stderr and stdout are written to their respective
	 * streams before rethrowing, so the error is still visible to humans and
	 * surfaced in CI logs.
	 *
	 * ```ts
	 * // vitest.setup.ts
	 * import { AgentPlugin } from "vitest-agent-plugin";
	 * export function setup() {
	 *   AgentPlugin.runScript("pnpm exec turbo run build:dev --output-logs=errors-only");
	 * }
	 * ```
	 */
	export function runScript(command: string): void {
		try {
			execSync(command, { stdio: "pipe" });
		} catch (error) {
			const execError = error as { stderr?: Buffer; stdout?: Buffer };
			if (execError.stderr?.length) process.stderr.write(execError.stderr);
			if (execError.stdout?.length) process.stdout.write(execError.stdout);
			throw error;
		}
	}
}

/**
 * Read the `outputFile` config for the `"vitest-agent"` key.
 *
 * @internal
 */
function resolveOutputDir(outputFile: string | Record<string, string> | undefined): string | null {
	if (!outputFile || typeof outputFile === "string") return null;
	return outputFile["vitest-agent"] ?? null;
}
