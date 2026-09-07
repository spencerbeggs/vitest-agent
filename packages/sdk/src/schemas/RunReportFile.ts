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
 * ISO-8601 instant, the shape `Date.prototype.toISOString` produces.
 * `Date.parse` alone is too permissive — it accepts `"Sep 7 2026"` and
 * other locale spellings a JSON Schema validator would reject — so the
 * pattern is checked first and the parse only rules out impossible
 * component values such as month 13.
 */
const ISO_8601_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const IsoInstant = Schema.String.check(
	Schema.makeFilter((value) =>
		ISO_8601_INSTANT.test(value) && !Number.isNaN(Date.parse(value))
			? undefined
			: `generatedAt ${value} must be an ISO-8601 instant, e.g. 2026-09-07T23:45:57.308Z.`,
	),
);

/**
 * Envelope for the `run.json` report file.
 *
 * @public
 */
export const RunReportFile = Schema.Struct({
	$schema: Schema.optional(Schema.String),
	schemaVersion: Schema.Literal(1),
	generatedAt: IsoInstant,
	reports: Schema.Array(AgentReport),
}).annotate({ identifier: "RunReportFile" });
/** @public */
export type RunReportFile = typeof RunReportFile.Type;
