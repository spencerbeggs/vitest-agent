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
	AgentPluginOptions,
	CoverageInput,
	CoverageLevelName,
	Environment,
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
 * Map strategy to output format for backward compatibility.
 *
 * @internal
 */
function resolveFormat(strategy: "own" | "complement", env: Environment, explicit?: OutputFormat): OutputFormat {
	if (explicit) return explicit;
	if (strategy === "own") {
		// "own" mode: agent gets the terminal formatter (plain text + ANSI;
		// no markdown noise for a target that doesn't render markdown).
		// Humans get silent so Vitest's own reporter handles their UX.
		return env === "agent-shell" ? "terminal" : "silent";
	}
	return "vitest-bypass";
}

/**
 * Resolve whether the reporter should write GFM to GITHUB_STEP_SUMMARY.
 *
 * @internal
 */
function resolveGithubActions(env: Environment, format: OutputFormat): boolean {
	if (env === "terminal") return false;
	if (format === "vitest-bypass" || format === "silent") return false;
	// GFM goes to the GitHub step summary file regardless of stdout format —
	// the markdown-rendering surface is independent of the terminal one.
	if (env === "ci-github" && (format === "markdown" || format === "terminal")) return true;
	return false;
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

export function AgentPlugin(options: AgentPluginConstructorOptions = {}, _layer?: Layer.Layer<EnvironmentDetector>) {
	const mode = options.mode ?? "auto";
	const strategy = options.strategy ?? "complement";
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

				log("mode:", mode, "| strategy:", strategy);

				// Determine environment from EnvironmentDetector service or forced mode
				let env: Environment;
				if (mode === "auto") {
					env = await Effect.runPromise(
						Effect.provide(
							Effect.flatMap(EnvironmentDetector, (d) => d.detect()),
							layer,
						),
					);
				} else {
					env = mode === "agent" ? "agent-shell" : "terminal";
				}
				log("env:", env);

				// Map strategy + environment to format
				const format = resolveFormat(strategy, env, options.format);
				log("format:", format);

				// Determine if this is an agent environment (for reporter stripping)
				const isAgentEnv = env === "agent-shell";

				// Strip reporters when actively taking over the console — both
				// `markdown` (legacy) and `terminal` (new default for agent
				// stdout) replace Vitest's own progress output.
				if ((format === "markdown" || format === "terminal") && isAgentEnv) {
					log("stripping console reporters");
					const stripped = stripConsoleReporters(vitest.config.reporters as unknown[]);
					// Write back via mutation (Vitest config is mutable at this point)
					(vitest.config as { reporters: unknown[] }).reporters = stripped;

					// Also suppress Vitest's native coverage text reporter (the big table)
					// since our reporter handles coverage output
					const coverageCfg = vitest.config.coverage as { reporter?: unknown[] } | undefined;
					if (coverageCfg) {
						log("suppressing native coverage text reporter");
						coverageCfg.reporter = [];
					}
				}

				// Complement mode warning: agent detected but no built-in agent reporter
				if (isAgentEnv && strategy === "complement" && format === "vitest-bypass") {
					const reporters = vitest.config.reporters as unknown[];
					const hasAgentReporter = reporters.some((r) => r === "agent" || (Array.isArray(r) && r[0] === "agent"));
					if (!hasAgentReporter) {
						process.stderr.write(
							'[vitest-agent] Warning: strategy is "complement" but ' +
								'Vitest\'s built-in "agent" reporter is not in the reporter chain. ' +
								"Console output may be verbose. Add 'agent' to your reporters or set " +
								'strategy: "own".\n',
						);
					}
				}

				// Resolve GFM based on env + format
				const githubActions = resolveGithubActions(env, format);
				log("githubActions:", githubActions);

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
					mode,
					logLevel: options.logLevel,
					logFile: options.logFile,
					mcp,
					githubActions,
					...(options.reporter !== undefined && { reporter: options.reporter }),
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
	 *   const { projects } = await AgentPlugin.discover();
	 *   return { plugins: [AgentPlugin()], test: { projects } };
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
