/**
 * @vitest-agent/sdk
 *
 * Platform-free core of the vitest-agent package family: Effect
 * schemas, the reporter and dispatcher contracts, errors, formatters,
 * and pure utilities. The services, Live layers, SQLite data layer,
 * migrations and platform resolution live in `@vitest-agent/engine`.
 *
 * @packageDocumentation
 */

// Dispatcher contract (consumed by @vitest-agent/ui's renderer cells + plugin)
export * from "./contracts/dispatcher.js";
// Reporter contract (consumed by vitest-agent plugin + reporter implementations)
export * from "./contracts/reporter.js";
// Errors
export * from "./errors/AgentErrors.js";
export * from "./errors/DataStoreError.js";
export * from "./errors/DiscoveryError.js";
export * from "./errors/PathResolutionError.js";
export * from "./errors/ProjectIdentityError.js";
export * from "./errors/RunContextError.js";
export * from "./errors/TddErrors.js";
// Formatters
export * from "./formatters/ci-annotations.js";
export * from "./formatters/gfm.js";
export * from "./formatters/json.js";
export * from "./formatters/markdown.js";
export * from "./formatters/silent.js";
export * from "./formatters/terminal.js";
export * from "./formatters/types.js";
// Schemas
export * from "./schemas/Agent.js";
export * from "./schemas/AgentReport.js";
export * from "./schemas/Baselines.js";
export * from "./schemas/CacheManifest.js";
export * from "./schemas/ChannelEvent.js";
export * from "./schemas/Common.js";
export * from "./schemas/Config.js";
export * from "./schemas/ConsoleLeaks.js";
export * from "./schemas/Coverage.js";
export * from "./schemas/CoverageLevel.js";
export * from "./schemas/CoverageTargets.js";
export * from "./schemas/History.js";
export * from "./schemas/Identity.js";
export * from "./schemas/Options.js";
export * from "./schemas/RenderState.js";
export * from "./schemas/RunEvent.js";
export * from "./schemas/RunReportFile.js";
export * from "./schemas/Tdd.js";
export * from "./schemas/TestArtifacts.js";
export * from "./schemas/Thresholds.js";
export * from "./schemas/Transport.js";
export * from "./schemas/Trends.js";
// 2.0 turn schemas
export * from "./schemas/turns/index.js";
// Utilities
export * from "./utils/ansi.js";
export * from "./utils/build-report.js";
export * from "./utils/canonicalize-git-url.js";
export * from "./utils/classify-test.js";
export * from "./utils/coerce-error-text.js";
export * from "./utils/compress-lines.js";
export * from "./utils/compute-trend.js";
export * from "./utils/console-leaks.js";
export * from "./utils/detect-non-default-discover-strategy.js";
export * from "./utils/detect-pm.js";
export { isTimeoutError } from "./utils/detect-timeout.js";
export * from "./utils/format-console.js";
export * from "./utils/format-fatal-error.js";
export * from "./utils/format-gfm.js";
export * from "./utils/format-scoped-coverage-note.js";
export * from "./utils/function-boundary.js";
export * from "./utils/hyperlink.js";
export * from "./utils/match-vitest-command.js";
export * from "./utils/normalize-workspace-key.js";
export * from "./utils/posix-path.js";
export * from "./utils/probe-host-metadata.js";
export * from "./utils/safe-filename.js";
export * from "./utils/test-location.js";
export * from "./utils/validate-coverage-targets-shape.js";
export * from "./utils/validate-phase-transition.js";

// --- Package version constant ---
export { CURRENT_SDK_VERSION } from "./version.js";
