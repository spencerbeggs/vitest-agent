/**
 * The committed `schemas/5.0/run.json` must match what `schemastore build`
 * would write from `RunReportFile` today, and the URL the reporter stamps
 * into every `run.json` must be the `$id` the config derives — a stale
 * document, a contract change without a version bump, or a URL that drifted
 * from the hosted identity fails here rather than shipping. Spawns the CLI,
 * hence `.e2e`.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RunReportSchemaHost } from "../lib/configs/run-report-schema.js";
import { RUN_REPORT_FILE_SCHEMA_URL } from "../src/schemas/RunReportFile.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

describe("run.json JSON Schema", () => {
	it("has no drift against the committed document", () => {
		const result = spawnSync(
			"pnpm",
			["exec", "schemastore", "check", "lib/configs/schemastore.config.ts", "--format=json"],
			{ cwd: packageRoot, encoding: "utf-8" },
		);
		expect(result.status, result.stderr).toBe(0);
		const report = JSON.parse(result.stdout) as {
			drifted: boolean;
			gateFailed: boolean;
			wrote: boolean;
			schemas: ReadonlyArray<{ outcome: string; findings: ReadonlyArray<{ severity: string }> }>;
		};
		expect(report).toMatchObject({ drifted: false, gateFailed: false, wrote: false });
		expect(report.schemas.map((schema) => schema.outcome)).toEqual(["unchanged"]);
		expect(report.schemas.flatMap((schema) => schema.findings.filter((f) => f.severity !== "advisory"))).toEqual([]);
	});

	it("stamps run.json with the $id the hosted identity derives", () => {
		expect(RUN_REPORT_FILE_SCHEMA_URL).toBe(RunReportSchemaHost.$id);
		const document = JSON.parse(readFileSync(`${repoRoot}schemas/5.0/run.json`, "utf-8")) as { $id: string };
		expect(document.$id).toBe(RUN_REPORT_FILE_SCHEMA_URL);
	});
});
