import type { PlatformOptions } from "@vitest-agent/engine";
import { PlatformLive } from "@vitest-agent/engine";
import { Layer } from "effect";
import { CoverageAnalyzerLive } from "./CoverageAnalyzerLive.js";

/**
 * Composition layer for a single `AgentReporter` run: the engine's
 * `PlatformLive` (SQLite, migrations, Node platform services, logger and
 * the shared service layers) plus the plugin-only `CoverageAnalyzer`.
 *
 * @param options - forwarded to `PlatformLive`; the reporter passes
 *   `process.env` as `env`
 * @public
 */
export const ReporterLive = (options: PlatformOptions) =>
	CoverageAnalyzerLive.pipe(Layer.provideMerge(PlatformLive(options)));
