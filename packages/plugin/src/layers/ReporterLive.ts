import type { PlatformLiveError, PlatformOptions, PlatformServices } from "@vitest-agent/engine";
import { PlatformLive } from "@vitest-agent/engine";
import { Layer } from "effect";
import type { CoverageAnalyzer } from "../services/CoverageAnalyzer.js";
import { CoverageAnalyzerLive } from "./CoverageAnalyzerLive.js";

/**
 * Composition layer for a single `AgentReporter` run: the engine's
 * `PlatformLive` (SQLite, migrations, Node platform services, logger and
 * the shared service layers) plus the plugin-only `CoverageAnalyzer`.
 *
 * The return type is spelled out so the emitted declaration names the
 * error through the engine's `PlatformLiveError` alias; left to inference
 * it is emitted via `@effected/store`, which this package does not depend
 * on and a root typecheck cannot resolve.
 *
 * @param options - forwarded to `PlatformLive`; the reporter passes
 *   `process.env` as `env`
 * @public
 */
export const ReporterLive = (
	options: PlatformOptions,
): Layer.Layer<CoverageAnalyzer | PlatformServices, PlatformLiveError> =>
	CoverageAnalyzerLive.pipe(Layer.provideMerge(PlatformLive(options)));
