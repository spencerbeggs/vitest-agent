import type { PlatformOptions, PlatformServices } from "@vitest-agent/engine";
import { PlatformLive } from "@vitest-agent/engine";
import { Layer } from "effect";
import type { MigrationError } from "effect/unstable/sql/Migrator";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { CoverageAnalyzer } from "../services/CoverageAnalyzer.js";
import { CoverageAnalyzerLive } from "./CoverageAnalyzerLive.js";

/**
 * Composition layer for a single `AgentReporter` run: the engine's
 * `PlatformLive` (SQLite, migrations, Node platform services, logger and
 * the shared service layers) plus the plugin-only `CoverageAnalyzer`.
 *
 * The return type is spelled out so the emitted declaration names
 * `MigrationError` through `effect/unstable/sql/Migrator`; left to
 * inference it is emitted via `@effect/sql-sqlite-node/SqliteMigrator`,
 * which this package does not depend on and a root typecheck cannot
 * resolve.
 *
 * @param options - forwarded to `PlatformLive`; the reporter passes
 *   `process.env` as `env`
 * @public
 */
export const ReporterLive = (
	options: PlatformOptions,
): Layer.Layer<CoverageAnalyzer | PlatformServices, MigrationError | SqlError> =>
	CoverageAnalyzerLive.pipe(Layer.provideMerge(PlatformLive(options)));
