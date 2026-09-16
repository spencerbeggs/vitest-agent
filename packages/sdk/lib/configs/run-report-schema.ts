/**
 * The hosted identity of the `run.json` JSON Schema document: the one value
 * `schemastore.config.ts` derives its `$id` and write path from. Lives under
 * `lib/` rather than `src/` because the sdk's `src/` never imports
 * `@effected/*` (`__test__/boundaries.test.ts`); `RUN_REPORT_FILE_SCHEMA_URL`
 * in `src/schemas/RunReportFile.ts` spells the same URL as a literal, and
 * `__test__/schema-drift.e2e.test.ts` pins the two together.
 */
import { HostedSchema } from "@effected/schemastore";

/** `https://raw.githubusercontent.com/spencerbeggs/vitest-agent/main/schemas/5.0/run.json` */
export const RunReportSchemaHost = HostedSchema.github({
	repo: "spencerbeggs/vitest-agent",
	path: "schemas",
	name: "run",
	versions: ["5.0"],
	appendVersion: false,
});
