/**
 * vitest-agent-plugin
 *
 * Vitest plugin for the vitest-agent ecosystem. Owns persistence, history
 * classification, baselines, trend tracking, failure-signature computation,
 * and Vitest reporter-chain wiring. Dispatches the rendering stage to a
 * configurable reporter — by default `DefaultVitestAgentReporter` from
 * `vitest-agent-reporter`, which the internal `AgentReporter` injects
 * when the user supplies no `reporter` factory option.
 *
 * This barrel re-exports `AgentPlugin` (the public plugin factory) and
 * `AgentReporter` (the internal Vitest-API reporter class).
 * `AgentReporter` delegates the rendering stage to the user-supplied
 * {@link VitestAgentReporter}; `AgentPlugin`'s `reporter` factory option
 * drives that delegation.
 *
 * @packageDocumentation
 */

// --- Plugin and internal Vitest reporter ---

export type { AgentPluginConstructorOptions } from "./plugin.js";
export { AgentPlugin } from "./plugin.js";
export type { AgentReporterConstructorOptions } from "./reporter.js";
export { AgentReporter } from "./reporter.js";
export type { InjectTagsResult } from "./utils/inject-tags.js";

// --- Discovery ---

export type { AddProjectInput, DiscoverBuilder, DiscoverResult } from "./plugin.js";
export type { DiscoverProjectsOptions, DiscoverProjectsResult } from "./utils/discover-projects.js";
export { discoverProjects } from "./utils/discover-projects.js";
export type {
	ClassifyContext,
	ClassifyFn,
	DiscoverInput,
	DiscoverStrategyCreateOptions,
	DiscoverStrategyExtendOptions,
	ModuleInfo,
	PackageJson as DiscoverPackageJson,
} from "./utils/discover-strategy.js";
export { DefaultDiscoverStrategy, DiscoverStrategy } from "./utils/discover-strategy.js";

// --- Classifier composition helpers ---

export {
	classifyByDirectory,
	classifyByFilename,
	combineClassifiers,
} from "./utils/classify-helpers.js";
export { findTestFiles } from "./utils/find-test-files.js";

// --- Coverage level API (re-exported from SDK so users only need one import) ---

export type { CoverageInput, CoverageLevelName } from "@vitest-agent/sdk";
export { CoverageLevel, resolveCoverageInput, validateCoverageConfig } from "@vitest-agent/sdk";
export type { CoverageLevelPreset } from "./plugin.js";

// Expose the AgentPlugin namespace statics as standalone named exports for convenience
import { AgentPlugin as _AgentPlugin } from "./plugin.js";
export const COVERAGE_LEVELS = _AgentPlugin.COVERAGE_LEVELS;
export const COVERAGE_LEVELS_PER_FILE = _AgentPlugin.COVERAGE_LEVELS_PER_FILE;
export const COVERAGE_AUTOUPDATE = _AgentPlugin.COVERAGE_AUTOUPDATE;

// --- Composition layer ---

export { ReporterLive } from "./layers/ReporterLive.js";

// --- CoverageAnalyzer service (only istanbul-aware service) ---

export { CoverageAnalyzerLive } from "./layers/CoverageAnalyzerLive.js";
export { CoverageAnalyzerTest } from "./layers/CoverageAnalyzerTest.js";
export { CoverageAnalyzer } from "./services/CoverageAnalyzer.js";

// --- ConfigValidation service ---

export { ConfigValidationLive } from "./layers/ConfigValidationLive.js";
export { ConfigValidationTest } from "./layers/ConfigValidationTest.js";
export type {
	ValidationError,
	ValidationInfo,
	ValidationInput,
	ValidationResult,
	ValidationWarning,
} from "./services/ConfigValidation.js";
export { ConfigValidation } from "./services/ConfigValidation.js";

// --- Reporter-side utilities ---

export { captureEnvVars } from "./utils/capture-env.js";
export { captureSettings, hashSettings } from "./utils/capture-settings.js";
export type { VitestErrorLike, VitestStackFrameLike } from "./utils/process-failure.js";
export { processFailure } from "./utils/process-failure.js";
export type { VitestThresholdsInput } from "./utils/resolve-thresholds.js";
export { resolveThresholds } from "./utils/resolve-thresholds.js";
export { CONSOLE_REPORTERS, stripConsoleReporters } from "./utils/strip-console-reporters.js";

// --- Tag primitive ---

// --- Cross-package version constant (T12 drift check) ---
// CURRENT_PLUGIN_VERSION is defined inside plugin.ts so the AgentPlugin
// factory can read it without a circular import from this barrel file.
export { CURRENT_PLUGIN_VERSION } from "./plugin.js";
export type { TagOptions } from "./utils/tag.js";
export { Tag } from "./utils/tag.js";
