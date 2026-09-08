import { readFileSync } from "node:fs";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { SchemaFile, SchemaPipeline, SchemaValidator } from "@effected/schemastore";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { runReportFileTarget, runReportFileWebsiteTarget, schemaTargets } from "../scripts/generate-schemas.js";
import { RUN_REPORT_FILE_SCHEMA_URL } from "../src/schemas/RunReportFile.js";

const PipelineLayer = Layer.mergeAll(SchemaFile.layer, SchemaValidator.layer).pipe(Layer.provide(NodeServices.layer));

const readDocument = (path: string): Record<string, unknown> =>
	JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;

describe("run-report-file JSON Schema", () => {
	it("has no drift against either committed document", async () => {
		const results = await Effect.runPromise(SchemaPipeline.check(schemaTargets).pipe(Effect.provide(PipelineLayer)));
		expect(results).toHaveLength(schemaTargets.length);
		for (const result of results) {
			expect(result.findings.filter((finding) => finding.severity === "warning")).toEqual([]);
			expect(result.blocked).toBe(false);
			expect(result.contractBlocked).toBe(false);
			expect(result.wouldWrite).toBe(false);
		}
	});

	it("publishes the document under the canonical $id", () => {
		const document = readDocument(runReportFileTarget.path);
		expect(document.$id).toBe(RUN_REPORT_FILE_SCHEMA_URL);
		expect(document.$schema).toBe("http://json-schema.org/draft-07/schema#");
	});

	it("serves the same document from the docs site's static tree", () => {
		expect(readDocument(runReportFileWebsiteTarget.path)).toEqual(readDocument(runReportFileTarget.path));
	});
});
