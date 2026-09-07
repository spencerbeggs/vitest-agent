/**
 * The `.vitest/vitest-agent/run.json` file contract.
 *
 * This is a versioned public contract, not the raw `AgentReport`
 * encoding — a Claude Code hook or a CI step reads this file, so the
 * envelope carries its own `schemaVersion`. `reports` holds one
 * `AgentReport` per Vitest project in the run.
 */

import { Schema } from "effect";
import { AgentReport } from "./AgentReport.js";

/**
 * Canonical `$schema` URL for `RunReportFile` version 1.
 *
 * Written as the first key of `run.json` so an editor or a JSON Schema
 * validator can resolve the contract without knowing about vitest-agent.
 *
 * @public
 */
export const RUN_REPORT_FILE_SCHEMA_URL = "https://vitest-agent.dev/schemas/run-report-file-1.0.0.json";

/**
 * Envelope for the `run.json` report file.
 *
 * @public
 */
export const RunReportFile = Schema.Struct({
	$schema: Schema.optional(Schema.String),
	schemaVersion: Schema.Literal(1),
	generatedAt: Schema.String,
	reports: Schema.Array(AgentReport),
}).annotate({ identifier: "RunReportFile" });
/** @public */
export type RunReportFile = typeof RunReportFile.Type;
