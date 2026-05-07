/**
 * vitest-agent
 *
 * Vitest plugin for the vitest-agent ecosystem. Owns persistence, history
 * classification, baselines, trend tracking, failure-signature computation,
 * and Vitest reporter-chain wiring. Dispatches the rendering stage to a
 * configurable reporter (default: `defaultReporter` from
 * `vitest-agent-reporter` package).
 *
 * The current export surface is transitional: `AgentReporter` and
 * `AgentPlugin` are re-exported here as a checkpoint after the file move
 * out of `vitest-agent`. The next refactor pass replaces
 * `AgentReporter` with an internal Vitest-API class that delegates the
 * rendering stage to the user-supplied {@link VitestAgentReporter}, and
 * `AgentPlugin` gains the `reporter` factory option that drives that
 * delegation.
 *
 * @packageDocumentation
 */

// --- Plugin and internal Vitest reporter ---

export type { AgentPluginConstructorOptions } from "./plugin.js";
export { AgentPlugin } from "./plugin.js";
export type { AgentReporterConstructorOptions } from "./reporter.js";
export { AgentReporter } from "./reporter.js";

// --- Discovery ---

export type {
	DiscoveryOptions,
	ProjectKindCallback,
	ProjectKindConfig,
	ProjectKindOverride,
	ProjectsCallback,
} from "./utils/discover-projects.js";
export { discoverProjects } from "./utils/discover-projects.js";
export type { VitestProjectKind, VitestProjectOptions } from "./utils/vitest-project.js";
export { VitestProject } from "./utils/vitest-project.js";

// --- Coverage level API (re-exported from SDK so users only need one import) ---

export type { CoverageInput, CoverageLevelName } from "vitest-agent-sdk";
export { CoverageLevel, resolveCoverageInput, validateCoverageConfig } from "vitest-agent-sdk";

// Expose the AgentPlugin namespace statics as standalone named exports for convenience
import { AgentPlugin as _AgentPlugin } from "./plugin.js";
export const COVERAGE_LEVELS = _AgentPlugin.COVERAGE_LEVELS;
export const COVERAGE_LEVELS_PER_FILE = _AgentPlugin.COVERAGE_LEVELS_PER_FILE;

// --- Composition layer ---

export { ReporterLive } from "./layers/ReporterLive.js";

// --- CoverageAnalyzer service (only istanbul-aware service) ---

export { CoverageAnalyzerLive } from "./layers/CoverageAnalyzerLive.js";
export { CoverageAnalyzerTest } from "./layers/CoverageAnalyzerTest.js";
export { CoverageAnalyzer } from "./services/CoverageAnalyzer.js";

// --- Reporter-side utilities ---

export { captureEnvVars } from "./utils/capture-env.js";
export { captureSettings, hashSettings } from "./utils/capture-settings.js";
export type { VitestErrorLike, VitestStackFrameLike } from "./utils/process-failure.js";
export { processFailure } from "./utils/process-failure.js";
export type { VitestThresholdsInput } from "./utils/resolve-thresholds.js";
export { resolveThresholds } from "./utils/resolve-thresholds.js";
export { CONSOLE_REPORTERS, stripConsoleReporters } from "./utils/strip-console-reporters.js";
