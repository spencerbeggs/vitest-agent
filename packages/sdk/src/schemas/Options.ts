/**
 * Configuration option schemas for AgentPlugin and the reporter contract.
 *
 * @packageDocumentation
 */

import { Schema } from "effect";
import { AgentConsoleMode, CiConsoleMode, HumanConsoleMode } from "./Common.js";
import { CoverageTargets } from "./CoverageTargets.js";
import { Transport } from "./Transport.js";

/**
 * Per-executor console-output matrix. Most users never set this — the
 * built-in defaults cover the common cases. Override per slot when you
 * want to force a specific layout for debugging or to suppress one
 * channel without affecting the others.
 *
 * Defaults:
 * - `human` → `"passthrough"` today; users opt into `"ink"` explicitly
 *   alongside wiring `createLiveInk` via `onRunEvent`.
 * - `agent` → `"agent"` (markdown-flavored final frame).
 * - `ci` → `"passthrough"` (Vitest's reporters produce log-friendly
 *   output). `"ci-annotations"` is opt-in until the dedicated GHA
 *   annotations writer ships.
 */
export const ConsoleOutputs = Schema.Struct({
	human: Schema.optional(HumanConsoleMode),
	agent: Schema.optional(AgentConsoleMode),
	ci: Schema.optional(CiConsoleMode),
}).annotations({ identifier: "ConsoleOutputs" });
export type ConsoleOutputs = typeof ConsoleOutputs.Type;

/**
 * The 2.0 user-facing options for {@link AgentPlugin}.
 *
 * Five fields total. Two are function-typed (`reporter`, `onRunEvent`)
 * and live on the `AgentPluginConstructorOptions` companion interface in
 * `vitest-agent-plugin` — Effect Schema cannot encode functions cleanly,
 * so the schema-decodable struct carries the three data-shaped fields.
 */
export const AgentPluginOptions = Schema.Struct({
	console: Schema.optional(ConsoleOutputs),
	coverageTargets: Schema.optional(CoverageTargets),
	transport: Schema.optional(Transport),
}).annotations({ identifier: "AgentPluginOptions" });
export type AgentPluginOptions = typeof AgentPluginOptions.Type;

/**
 * Reporter-implementation options.
 *
 * Public for users building custom reporters via `vitest-agent-reporter`;
 * most users never see this type — they wire `AgentPlugin({ reporter })`
 * and the factory receives a fully-resolved `ReporterKit` instead.
 *
 * Carries internal flags the plugin sets when constructing the reporter
 * (currently only `projectFilter` for per-project scoping).
 */
export const AgentReporterOptions = Schema.Struct({
	/** Set by the plugin per-project. Filters reports to one project. */
	projectFilter: Schema.optional(Schema.String),
}).annotations({ identifier: "AgentReporterOptions" });
export type AgentReporterOptions = typeof AgentReporterOptions.Type;
