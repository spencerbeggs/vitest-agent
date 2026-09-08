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

const ISO_8601_MESSAGE = "generatedAt must be an ISO-8601 instant, e.g. 2026-09-07T23:45:57.308Z.";

const IsoInstant = Schema.String.check(
	// No `format: "date-time"` annotation: the pipeline's ajv gate ships
	// without ajv-formats and rejects the document with `unknown format
	// "date-time"`, so the pattern is the contract a reader validates on.
	Schema.isPattern(ISO_8601_INSTANT, {
		description: "An ISO-8601 instant, the shape Date.prototype.toISOString produces.",
		message: ISO_8601_MESSAGE,
	}),
	// Rules out impossible component values (month 13, hour 99) the pattern
	// alone admits. It has no JSON Schema representation, so the emitted
	// document carries only the pattern above.
	Schema.makeFilter((value) => (Number.isNaN(Date.parse(value)) ? ISO_8601_MESSAGE : undefined)),
).annotate({ identifier: "IsoInstant" });

/**
 * Envelope for the `run.json` report file.
 *
 * @public
 */
export const RunReportFile = Schema.Struct({
	$schema: Schema.optionalKey(Schema.String),
	schemaVersion: Schema.Literal(1),
	generatedAt: IsoInstant,
	reports: Schema.Array(AgentReport),
}).annotate({
	identifier: "RunReportFile",
	description:
		"The vitest-agent run report file (.vitest/vitest-agent/run.json): one AgentReport per Vitest project from the most recent run.",
	"x-ai-hint":
		"Read reports[].summary for pass/fail counts and reports[].failures for the failing tests. schemaVersion is the envelope contract version; generatedAt is when the run finished.",
});
/** @public */
export type RunReportFile = typeof RunReportFile.Type;
