/**
 * @vitest-agent/engine
 *
 * Platform-dependent half of the former `@vitest-agent/sdk` (issue #412):
 * Effect services, Live layers, the SQLite data layer, migrations, the
 * shared triage/wrapup programs, and platform resolution. Consumed by
 * `@vitest-agent/cli`, `@vitest-agent/mcp` and `@vitest-agent/plugin`.
 * Schemas, contracts, errors, formatters and pure utilities stay in
 * `@vitest-agent/sdk`.
 *
 * @packageDocumentation
 */

// Layers
export * from "./layers/ConfigLive.js";
export * from "./layers/DataReaderLive.js";
export * from "./layers/DataStoreLive.js";
export * from "./layers/DetailResolverLive.js";
export * from "./layers/DiscoveryRegistryLive.js";
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
export * from "./layers/PerClientSessionMapLive.js";
export * from "./layers/ProjectDiscoveryLive.js";
export * from "./layers/ProjectDiscoveryTest.js";
export * from "./layers/ProjectIdentityLive.js";
export * from "./layers/RunContextLive.js";
// 2.0 RC: shared markdown generators (consumed by CLI + MCP).
export type { FormatTriageOptions } from "./lib/format-triage.js";
export { formatTriageEffect } from "./lib/format-triage.js";
export type { FormatWrapupOptions, WrapupKind } from "./lib/format-wrapup.js";
export { formatWrapupEffect } from "./lib/format-wrapup.js";
// Migrations
export { default as migration0001 } from "./migrations/0001_initial.js";
export { default as migration0002 } from "./migrations/0002_test_artifacts.js";
export { PROJECT_MIGRATIONS } from "./migrations/index.js";
export { default as registryMigration0001 } from "./migrations/registry_0001_initial.js";
export { default as sessionMapMigration0001 } from "./migrations/session_map_0001_initial.js";
// Platform assembly + project-dir resolution
export * from "./platform.js";
// Programs shared by the CLI and the MCP server (hook plumbing, recording,
// session recovery) plus the sidecar platform assembly.
export * from "./programs/end-agent.js";
export * from "./programs/hook-paths.js";
export * from "./programs/platform-sidecar.js";
export * from "./programs/record-session.js";
export * from "./programs/record-tdd-artifact.js";
export * from "./programs/record-turn.js";
export * from "./programs/record-workspace-changes.js";
export * from "./programs/register-agent.js";
export * from "./programs/resolve-session-for-recording.js";
export * from "./programs/session-env.js";
export * from "./project-dir.js";
// Services
export * from "./services/Config.js";
export * from "./services/DataReader.js";
export * from "./services/DataStore.js";
export * from "./services/DetailResolver.js";
export * from "./services/DiscoveryRegistry.js";
export * from "./services/EnvironmentDetector.js";
export * from "./services/ExecutorResolver.js";
export * from "./services/FormatSelector.js";
export * from "./services/HistoryTracker.js";
export * from "./services/idempotency.js";
export * from "./services/OutputRenderer.js";
export * from "./services/PerClientSessionMap.js";
export * from "./services/ProjectDiscovery.js";
export * from "./services/ProjectIdentity.js";
export * from "./services/RunContext.js";
// SQL helpers (assemblers public; raw row schemas are internal)
export * from "./sql/assemblers.js";
// Platform utilities
export * from "./utils/ensure-migrated.js";
export * from "./utils/failure-signature.js";
export * from "./utils/resolve-data-path.js";
export * from "./utils/resolve-project-key-from-cwd.js";
export * from "./utils/resolve-workspace-key.js";

export { CURRENT_ENGINE_VERSION } from "./version.js";
