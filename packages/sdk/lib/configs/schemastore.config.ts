/**
 * The whole schema setup for `@vitest-agent/sdk`: `RunReportFile` becomes the
 * published `run.json` JSON Schema document at the repo-root `schemas/`
 * directory GitHub serves raw, hosted at `RunReportSchemaHost` — the same URL
 * the reporter stamps into every `run.json`'s `$schema` key. Objects stay
 * open (`onExcessProperty: "ignore"`) to match how `RunReportFile` decodes.
 * Run via `pnpm schema:build` / `pnpm schema:check`
 * (`okf/interfaces/published-json-schemas.md`).
 */
import { defineConfig } from "@effected/schemastore";
import { RunReportFile } from "../../src/schemas/RunReportFile.js";
import { RunReportSchemaHost } from "./run-report-schema.js";

export default defineConfig({
	outputDir: "../../../../schemas",
	schemas: {
		[RunReportSchemaHost.name]: {
			schema: RunReportFile,
			hosted: RunReportSchemaHost,
			jsonSchema: { onExcessProperty: "ignore" },
		},
	},
});
