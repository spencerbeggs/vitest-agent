/**
 * vitest-agent-sdk
 *
 * Shared library for the vitest-agent package family. Carries
 * everything both runtime packages (reporter, mcp, cli) need: Effect
 * schemas, SQLite migrations and data layer, output pipeline services
 * and formatters, and supporting utilities.
 *
 * @packageDocumentation
 */

// Reporter contract (consumed by vitest-agent plugin + reporter implementations)
export * from "./contracts/reporter.js";
// Errors
export * from "./errors/DataStoreError.js";
export * from "./errors/DiscoveryError.js";
export * from "./errors/PathResolutionError.js";
export * from "./errors/TddErrors.js";
// Formatters
export * from "./formatters/ci-annotations.js";
export * from "./formatters/gfm.js";
export * from "./formatters/json.js";
export * from "./formatters/markdown.js";
export * from "./formatters/silent.js";
export * from "./formatters/terminal.js";
export * from "./formatters/types.js";
// Layers
export * from "./layers/ConfigLive.js";
export * from "./layers/DataReaderLive.js";
export * from "./layers/DataStoreLive.js";
export * from "./layers/DataStoreTest.js";
export * from "./layers/DetailResolverLive.js";
export * from "./layers/EnvironmentDetectorLive.js";
export * from "./layers/EnvironmentDetectorTest.js";
export * from "./layers/ExecutorResolverLive.js";
export * from "./layers/FormatSelectorLive.js";
export * from "./layers/HistoryTrackerLive.js";
export * from "./layers/HistoryTrackerTest.js";
export * from "./layers/LoggerLive.js";
export * from "./layers/OutputPipelineLive.js";
export * from "./layers/OutputRendererLive.js";
export * from "./layers/PathResolutionLive.js";
export * from "./layers/ProjectDiscoveryLive.js";
export * from "./layers/ProjectDiscoveryTest.js";
// 2.0 RC: shared markdown generators (consumed by CLI + MCP).
export type { FormatTriageOptions } from "./lib/format-triage.js";
export { formatTriageEffect } from "./lib/format-triage.js";
export type { FormatWrapupOptions, WrapupKind } from "./lib/format-wrapup.js";
export { formatWrapupEffect } from "./lib/format-wrapup.js";
// Migrations
export { default as migration0001 } from "./migrations/0001_initial.js";
export { default as migration0002 } from "./migrations/0002_comprehensive.js";
// Schemas
export * from "./schemas/AgentReport.js";
export * from "./schemas/Baselines.js";
export * from "./schemas/CacheManifest.js";
export * from "./schemas/ChannelEvent.js";
export * from "./schemas/Common.js";
export * from "./schemas/Config.js";
export * from "./schemas/Coverage.js";
export * from "./schemas/History.js";
export * from "./schemas/Options.js";
export * from "./schemas/Tdd.js";
export * from "./schemas/Thresholds.js";
export * from "./schemas/Trends.js";
// 2.0 turn schemas
export * from "./schemas/turns/index.js";
// Services
export * from "./services/Config.js";
export * from "./services/DataReader.js";
export * from "./services/DataStore.js";
export * from "./services/DetailResolver.js";
export * from "./services/EnvironmentDetector.js";
export * from "./services/ExecutorResolver.js";
export * from "./services/FormatSelector.js";
export * from "./services/HistoryTracker.js";
export * from "./services/OutputRenderer.js";
export * from "./services/ProjectDiscovery.js";
// SQL helpers (assemblers public; raw row schemas are internal)
export * from "./sql/assemblers.js";
// Utilities
export * from "./utils/ansi.js";
export * from "./utils/build-report.js";
export * from "./utils/classify-test.js";
export * from "./utils/compress-lines.js";
export * from "./utils/compute-trend.js";
export * from "./utils/detect-pm.js";
export * from "./utils/ensure-migrated.js";
export * from "./utils/failure-signature.js";
export * from "./utils/format-console.js";
export * from "./utils/format-fatal-error.js";
export * from "./utils/format-gfm.js";
export * from "./utils/function-boundary.js";
export * from "./utils/hyperlink.js";
export * from "./utils/normalize-workspace-key.js";
export * from "./utils/resolve-data-path.js";
export * from "./utils/resolve-workspace-key.js";
export * from "./utils/safe-filename.js";
export * from "./utils/split-project.js";
export * from "./utils/validate-phase-transition.js";
