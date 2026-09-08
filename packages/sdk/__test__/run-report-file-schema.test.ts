import { readFileSync } from "node:fs";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { SchemaFile, SchemaPipeline, SchemaValidator } from "@effected/schemastore";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { runReportFileTarget } from "../scripts/generate-schemas.js";
import { RUN_REPORT_FILE_SCHEMA_URL } from "../src/schemas/RunReportFile.js";

const PipelineLayer = Layer.mergeAll(SchemaFile.layer, SchemaValidator.layer).pipe(Layer.provide(NodeServices.layer));

describe("run-report-file JSON Schema", () => {
	it("has no drift against the committed document", async () => {
		const results = await Effect.runPromise(
			SchemaPipeline.check([runReportFileTarget]).pipe(Effect.provide(PipelineLayer)),
		);
		expect(results).toHaveLength(1);
		const [result] = results;
		expect(result?.findings.filter((finding) => finding.severity === "warning")).toEqual([]);
		expect(result?.blocked).toBe(false);
		expect(result?.contractBlocked).toBe(false);
		expect(result?.wouldWrite).toBe(false);
	});

	it("publishes the document under the canonical $id", () => {
		const document = JSON.parse(readFileSync(runReportFileTarget.path, "utf-8")) as Record<string, unknown>;
		expect(document.$id).toBe(RUN_REPORT_FILE_SCHEMA_URL);
		expect(document.$schema).toBe("http://json-schema.org/draft-07/schema#");
	});
});
