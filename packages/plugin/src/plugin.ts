import { execSync } from "node:child_process";
import type { TestTagDefinition } from "@vitest/runner";
import type {
	AgentPluginOptions,
	ConsoleMode,
	CoverageLevelName,
	Environment,
	Executor,
	OutputFormat,
	RunEvent,
	Transport,
	VitestAgentReporterFactory,
} from "@vitest-agent/sdk";
import {
	AgentConsoleMode,
	CiConsoleMode,
	CoverageLevel,
	EnvironmentDetector,
	EnvironmentDetectorLive,
	HumanConsoleMode,
	formatFatalError,
	resolveLogLevel,
} from "@vitest-agent/sdk";
import type { Layer } from "effect";
import { Effect, Schema } from "effect";
import type { TestProjectInlineConfiguration } from "vitest/config";
import type { VitestPluginContext } from "vitest/node";
import { ConfigValidationLive } from "./layers/ConfigValidationLive.js";
import { AgentReporter } from "./reporter.js";
import { ConfigValidation } from "./services/ConfigValidation.js";
import { buildModuleInfo } from "./utils/build-module-info.js";
import type { DiscoverProjectsOptions } from "./utils/discover-projects.js";
import { discoverProjects } from "./utils/discover-projects.js";
import type { DiscoverStrategy } from "./utils/discover-strategy.js";
import { DefaultDiscoverStrategy } from "./utils/discover-strategy.js";
import type { InjectTagsResult } from "./utils/inject-tags.js";
import { injectTags } from "./utils/inject-tags.js";
import { resolveThresholds } from "./utils/resolve-thresholds.js";
import { stripConsoleReporters } from "./utils/strip-console-reporters.js";

/**
 * Plugin options shape with the (function-typed) `reporter` factory added
 * on top of the schema-defined `AgentPluginOptions`. Schema can't
 * easily encode functions, so the factory lives outside the published
 * Effect Schema.
 * @public
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
	 * per-module `RunEvent` to this callback as the test run
	 * progresses. Hosts drive a live renderer (Ink, debug logging) from
	 * here. Throwing taps are caught and logged to stderr.
	 */
	onRunEvent?: (event: RunEvent) => void;
	/**
	 * Controls the Vite transform hook that rewrites test() and it() call
	 * options to inject filename-derived tags. Pass a DiscoverStrategy
	 * instance to customize classification, or false to disable the
	 * transform entirely.
	 *
	 * Defaults to a fresh DefaultDiscoverStrategy (unit / int / e2e by
	 * filename suffix).
	 */
	discoverStrategy?: DiscoverStrategy | false;
}

/**
 * Resolve which {@link ConsoleMode} value applies to the active executor.
 * Looks up `console.{executor}` in the user-supplied matrix, falls back to
 * the per-slot default.
 *
 * Per-slot defaults:
 * - `human` → `passthrough` (Vitest's own reporters do the visible work).
 *   Users opt into `stream` for the progressively-drawn, animated
 *   agent-shaped live renderer by setting the `human` slot to `"stream"`;
 *   the default reporter owns the live Ink mount end to end (T6 contract
 *   — users do not import or wire the live renderer themselves).
 * - `agent` → `agent` (markdown-flavored final-frame string).
 * - `ci` → `passthrough` (Vitest's reporters produce log-friendly output;
 *   the dedicated `ci-annotations` reporter is opt-in until the GHA
 *   annotations writer ships).
 *
 * @internal
 */
export function resolveConsoleMode(
	options: AgentPluginConstructorOptions,
	executor: Executor,
	_env: Environment,
): ConsoleMode {
	const override = process.env.VITEST_AGENT_CONSOLE;
	if (override !== undefined && override !== "") {
		// Each per-slot Schema.is call is a narrowed Literal check.  Forming a
		// single ternary-produced union of the three Literal schemas confuses
		// tsgo (annotations-method contravariance), so the three guards stay
		// separate.
		if (executor === "human" && Schema.is(HumanConsoleMode)(override)) return override;
		if (executor === "agent" && Schema.is(AgentConsoleMode)(override)) return override;
		if (executor !== "human" && executor !== "agent" && Schema.is(CiConsoleMode)(override)) return override;
		process.stderr.write(
			`[vitest-agent:plugin] ignoring invalid VITEST_AGENT_CONSOLE="${override}" for ${executor} executor\n`,
		);
	}
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
 * (stream, agent, ci-annotations) need exclusive stdout access.
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
function resolveFormat(mode: ConsoleMode): OutputFormat {
	switch (mode) {
		case "stream":
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

/**
 * The version of this package, inlined at build time from
 * `package.json#version` via rslib-builder's `__PACKAGE_VERSION__` substitution.
 * Re-exported from the package barrel as the public symbol; defined here so
 * consumers can introspect the running plugin version without a circular import.
 *
 * @public
 */
export const CURRENT_PLUGIN_VERSION: string = process.env.__PACKAGE_VERSION__ ?? "0.0.0";

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

/**
 * Vitest plugin that injects `AgentReporter` into the reporter chain.
 *
 * @param options - Plugin configuration options
 * @param _layer - Internal: override the EnvironmentDetector layer (for testing)
 * @returns Vitest plugin object with `configureVitest` hook
 *
 * @public
 */
export function AgentPlugin(options: AgentPluginConstructorOptions = {}, _layer?: Layer.Layer<EnvironmentDetector>) {
	const layer = _layer ?? EnvironmentDetectorLive;

	// Plugin's own debug-log helper reads VITEST_REPORTER_LOG_LEVEL via
	// resolveLogLevel; `logLevel` is no longer a user option.
	const logLevel = resolveLogLevel();
	const shouldLog = logLevel !== undefined && logLevel._tag !== "None";
	const log = shouldLog
		? (...args: unknown[]) => process.stderr.write(`[vitest-agent:plugin] ${args.map(String).join(" ")}\n`)
		: (..._args: unknown[]) => {};

	const discoverStrategyResolved =
		options.discoverStrategy === false ? null : (options.discoverStrategy ?? new DefaultDiscoverStrategy());

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
				const format = resolveFormat(consoleMode);
				// `mcp` is auto-derived from the detected executor — the agent
				// slot is the only one that owns the MCP attribution path.
				const mcp = executor === "agent";
				log(
					"env:",
					env,
					"| executor:",
					executor,
					"| consoleMode:",
					consoleMode,
					"| format:",
					format,
					"| mcp (auto):",
					mcp,
				);

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

				// GitHub Actions step summary auto-derives from the detected
				// environment and the resolved console mode — there is no
				// user-facing `githubSummary` option. Users who need to
				// suppress it can set the matching `console.ci` slot to
				// `"silent"`.
				const githubActions = env === "ci-github" && consoleMode !== "silent";
				log("githubActions (auto):", githubActions);

				// Run ConfigValidation — replaces the inline resolveCoverageInput +
				// validateCoverageConfig block (Phase 4). Errors throw and refuse to
				// start the run; warnings and info entries are printed to stderr.
				const validation = await Effect.runPromise(
					Effect.provide(
						Effect.flatMap(ConfigValidation, (cv) =>
							cv.validate({ vitestConfig: vitest.config, pluginOptions: options }),
						),
						ConfigValidationLive,
					),
				);

				for (const w of validation.warnings) {
					process.stderr.write(
						`[vitest-agent:plugin] warning ${w.code}: ${w.message}` +
							(w.remediation ? `\n  ${w.remediation}` : "") +
							"\n",
					);
				}
				for (const i of validation.info) {
					process.stderr.write(`[vitest-agent:plugin] info ${i.code}: ${i.message}\n`);
				}
				if (validation.errors.length > 0) {
					const body = validation.errors
						.map(
							(e) =>
								`${e.code}${e.path ? ` @ ${e.path}` : ""}: ${e.message}` +
								(e.remediation ? `\n  ${e.remediation}` : ""),
						)
						.join("\n");
					// Throw a plain Error; the outer catch in configureVitest already
					// applies formatFatalError before writing to stderr. Wrapping twice
					// would duplicate the issue-URL footer the formatter appends.
					throw new Error(body);
				}

				// Resolve coverage thresholds from Vitest's native config.
				const coverageConfig = vitest.config.coverage as
					| { thresholds?: Record<string, unknown>; enabled?: boolean }
					| undefined;
				const coverageThresholds = coverageConfig?.thresholds
					? resolveThresholds(coverageConfig.thresholds as Record<string, unknown>)
					: undefined;

				// Resolve coverageTargets from plugin options. resolveThresholds
				// preserves the `100: true` shorthand and glob-pattern entries, and
				// leaves unset metrics absent on `global` instead of defaulting to 0.
				const rawTargets = options.coverageTargets as Record<string, unknown> | undefined;
				const coverageTargets = rawTargets ? resolveThresholds(rawTargets) : undefined;

				// Resolve operating mode from Vitest's native coverage.enabled.
				// Full when coverage.enabled !== false; UI-only otherwise.
				const coverageMode: "full" | "ui-only" = coverageConfig?.enabled === false ? "ui-only" : "full";

				// `transport` is forward-declared in 2.x; only `{ kind: "local" }`
				// is a valid member. The plugin threads it onto the reporter
				// kit so custom reporters can branch on backend kind.
				const transport: Transport = options.transport ?? { kind: "local" };
				log("transport.kind:", transport.kind);

				// Capture Vitest's native `test.passWithNoTests` (Vitest's own
				// default is `false`) and forward it onto ResolvedReporterConfig
				// so consumer reporters / UIs can render the resolved policy
				// alongside other run context. The MCP `run_tests` tool does
				// not read this snapshot — when its per-call override is unset
				// the tool forwards nothing to `createVitest` and Vitest
				// re-resolves the policy from the project config on disk.
				const passWithNoTestsRaw = (vitest.config as { passWithNoTests?: unknown }).passWithNoTests;
				const passWithNoTests = typeof passWithNoTestsRaw === "boolean" ? passWithNoTestsRaw : undefined;
				log("passWithNoTests (resolved):", passWithNoTests);

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
					...(coverageThresholds !== undefined ? { coverageThresholds } : {}),
					...(coverageTargets !== undefined ? { coverageTargets } : {}),
					coverageMode,
					format,
					consoleMode,
					mcp,
					githubActions,
					transport,
					...(passWithNoTests !== undefined ? { passWithNoTests } : {}),
					...(options.reporter !== undefined && { reporter: options.reporter }),
					// onRunEvent is the user-facing tee on the plugin's run-event
					// stream (T6 contract). Forward it unconditionally so the
					// user callback runs alongside the built-in reporter for
					// every consoleMode. Errors thrown by the user callback are
					// caught and logged to stderr by `AgentReporter.emit`.
					...(options.onRunEvent !== undefined ? { onRunEvent: options.onRunEvent } : {}),
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

	if (discoverStrategyResolved) {
		pluginObj.transform = (code, id) => {
			const cleanId = id.split("?")[0] ?? id;
			if (!isTestFile(cleanId)) return null;
			const module = buildModuleInfo(cleanId);
			const tags = discoverStrategyResolved.classify({ module });
			if (tags.length === 0) return null;
			const rewritten = injectTags(code, [...tags]);
			if (rewritten === null) return null;
			return rewritten;
		};
	}

	return pluginObj;
}

/**
 * Dual-output preset shape returned by `AgentPlugin.COVERAGE_LEVELS` and
 * `AgentPlugin.COVERAGE_LEVELS_PER_FILE`. The `thresholds` half is
 * passed to Vitest's native `coverage.thresholds`; the `coverageTargets`
 * half is passed to `AgentPlugin({ coverageTargets })`.
 *
 * `thresholds` carries the optional `perFile` flag; `coverageTargets`
 * does not — it inherits `perFile` from `coverage.thresholds.perFile`.
 * @public
 */
export interface CoverageLevelPreset {
	readonly thresholds: {
		readonly lines: number;
		readonly functions: number;
		readonly branches: number;
		readonly statements: number;
		readonly perFile?: boolean;
	};
	readonly coverageTargets: {
		readonly lines: number;
		readonly functions: number;
		readonly branches: number;
		readonly statements: number;
	};
}

const PRESET_METRICS = (level: CoverageLevel) => ({
	lines: level.lines,
	functions: level.functions,
	branches: level.branches,
	statements: level.statements,
});

const buildPreset = (
	thresholdsLevel: CoverageLevel,
	targetsLevel: CoverageLevel,
	perFile: boolean,
): CoverageLevelPreset =>
	Object.freeze({
		thresholds: Object.freeze({
			...PRESET_METRICS(thresholdsLevel),
			...(perFile ? { perFile: true as const } : {}),
		}),
		coverageTargets: Object.freeze(PRESET_METRICS(targetsLevel)),
	});

// ── DiscoverBuilder ────────────────────────────────────────────────────────────

/**
 * An entry added via {@link DiscoverBuilder.addProject}.
 * @public
 */
export interface AddProjectInput {
	readonly name: string;
	readonly path: string;
}

/**
 * The resolved result of a {@link DiscoverBuilder} — a drop-in replacement for
 * the old `DiscoverProjectsResult` on the public surface.
 * @public
 */
export interface DiscoverResult {
	readonly projects: TestProjectInlineConfiguration[] | undefined;
	readonly tags: TestTagDefinition[];
}

/**
 * Thenable builder returned by `AgentPlugin.discover`. Calling `.then()`
 * (or `await`-ing) materializes the discovery: workspace packages + added
 * entries are each run through the active strategy's `buildProject`, with
 * conflict detection on `name` or normalized path collisions.
 *
 * The builder is **immutable** — each `.addProject()` call returns a new
 * builder; the original is unchanged.
 *
 * @public
 */
export interface DiscoverBuilder extends PromiseLike<DiscoverResult> {
	addProject(input: AddProjectInput): DiscoverBuilder;
}

/**
 * Create a concrete {@link DiscoverBuilder} for the given strategy and
 * accumulated additional entries. Calling `.then()` triggers `discoverProjects`
 * with all accumulated options.
 *
 * Process-level cache rule (spec §3.3): caching fires only when no explicit
 * `strategy` is provided AND `additionalEntries` is empty. Any `.addProject()`
 * chain or explicit strategy bypasses the cache.
 *
 * @internal
 */
function makeDiscoverBuilder(options: DiscoverProjectsOptions): DiscoverBuilder {
	return {
		addProject(input: AddProjectInput): DiscoverBuilder {
			// Immutable: return a fresh builder with the entry appended.
			return makeDiscoverBuilder({
				...options,
				additionalEntries: [...(options.additionalEntries ?? []), { name: input.name, path: input.path }],
			});
		},

		// biome-ignore lint/suspicious/noThenProperty: intentional PromiseLike thenable for DiscoverBuilder
		then<TResult1 = DiscoverResult, TResult2 = never>(
			onFulfilled?: ((value: DiscoverResult) => TResult1 | PromiseLike<TResult1>) | null | undefined,
			onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null | undefined,
		): Promise<TResult1 | TResult2> {
			return discoverProjects(options).then(onFulfilled, onRejected) as Promise<TResult1 | TResult2>;
		},
	};
}

/**
 * Static namespace attached to the `AgentPlugin` factory function.
 * Exposes coverage-level preset maps, auto-update tolerance functions, and the `discover` thenable builder.
 * @public
 */
export namespace AgentPlugin {
	export const COVERAGE_LEVELS: Readonly<Record<CoverageLevelName, CoverageLevelPreset>> = Object.freeze({
		none: buildPreset(CoverageLevel.none, CoverageLevel.basic, false),
		basic: buildPreset(CoverageLevel.basic, CoverageLevel.standard, false),
		standard: buildPreset(CoverageLevel.standard, CoverageLevel.strict, false),
		strict: buildPreset(CoverageLevel.strict, CoverageLevel.full, false),
		full: buildPreset(CoverageLevel.full, CoverageLevel.full, false),
	});

	export const COVERAGE_LEVELS_PER_FILE: Readonly<Record<CoverageLevelName, CoverageLevelPreset>> = Object.freeze({
		none: buildPreset(CoverageLevel.none, CoverageLevel.basic, true),
		basic: buildPreset(CoverageLevel.basic, CoverageLevel.standard, true),
		standard: buildPreset(CoverageLevel.standard, CoverageLevel.strict, true),
		strict: buildPreset(CoverageLevel.strict, CoverageLevel.full, true),
		full: buildPreset(CoverageLevel.full, CoverageLevel.full, true),
	});

	/**
	 * Tolerance functions for Vitest's `coverage.thresholds.autoUpdate` field.
	 *
	 * Vitest's contract: `autoUpdate?: boolean | ((newThreshold: number) => number)`.
	 * Pass one of these functions directly. `standard` floors; `strict` ceils;
	 * `lenient` floors and subtracts 2 (clamped to 0) to leave a slack buffer.
	 *
	 * ```ts
	 * defineConfig({
	 *   test: { coverage: { thresholds: {
	 *     autoUpdate: AgentPlugin.COVERAGE_AUTOUPDATE.standard,
	 *     lines: 80,
	 *   } } },
	 * });
	 * ```
	 */
	export const COVERAGE_AUTOUPDATE: Readonly<{
		standard: (n: number) => number;
		strict: (n: number) => number;
		lenient: (n: number) => number;
	}> = Object.freeze({
		standard: (n: number) => Math.floor(n),
		strict: (n: number) => Math.ceil(n),
		lenient: (n: number) => Math.max(0, Math.floor(n - 2)),
	});

	/**
	 * Discover Vitest project configs and tag definitions from the workspace layout.
	 * Returns a thenable {@link DiscoverBuilder} that supports `.addProject()` for
	 * non-package folders that hold tests.
	 *
	 * Awaiting (or calling `.then`) materializes the result. Each `.addProject()`
	 * returns a new immutable builder; the original is unchanged.
	 *
	 * Process-level cache: only the no-arg, no-added-projects call path caches by
	 * workspace root. Any `.addProject()` chain or explicit strategy bypasses it.
	 *
	 * ```ts
	 * export default async () => {
	 *   const { projects, tags } = await AgentPlugin.discover()
	 *     .addProject({ name: "integration", path: "./test-only" });
	 *   return defineConfig({
	 *     plugins: [AgentPlugin()],
	 *     test: { ...(projects ? { projects } : {}), tags },
	 *   });
	 * };
	 * ```
	 *
	 * @param strategy - Optional strategy or options object `{ strategy?, cwd? }`.
	 *   Pass a {@link DiscoverStrategy} directly, or an options object to also
	 *   specify a custom workspace root via `cwd`.
	 */
	export function discover(
		strategy?: DiscoverStrategy | { strategy?: DiscoverStrategy; cwd?: string },
	): DiscoverBuilder {
		if (strategy === undefined) {
			return makeDiscoverBuilder({});
		}
		// Duck-type: a DiscoverStrategy has buildProject + tags + classify methods.
		// An options object has at most strategy/cwd keys (no buildProject directly).
		if (typeof (strategy as DiscoverStrategy).buildProject === "function") {
			return makeDiscoverBuilder({ strategy: strategy as DiscoverStrategy });
		}
		// Options object form: { strategy?, cwd? }
		const opts = strategy as { strategy?: DiscoverStrategy; cwd?: string };
		return makeDiscoverBuilder({
			...(opts.strategy !== undefined ? { strategy: opts.strategy } : {}),
			...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
		});
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
	 * import { AgentPlugin } from "@vitest-agent/plugin";
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
