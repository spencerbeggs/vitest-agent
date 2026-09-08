/**
 * Emits the published JSON Schema documents for `@vitest-agent/sdk`.
 *
 * `pnpm --filter @vitest-agent/sdk schemas:generate` writes them, and
 * `schemas:check` reports drift without touching the filesystem, exiting
 * non-zero when a document is stale or blocked. The drift test imports {@link runReportFileTarget}
 * from here so the committed file and the test are gated on one target.
 */

import process from "node:process";
import { fileURLToPath } from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { SchemaFile, SchemaPipeline, SchemaTarget, SchemaValidator, SchemaVersioning } from "@effected/schemastore";
import { Effect, Layer, Result } from "effect";
import { RUN_REPORT_FILE_SCHEMA_URL, RunReportFile } from "../src/schemas/RunReportFile.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

const RUN_REPORT_FILE_NAME = "run-report-file";
const RUN_REPORT_FILE_VERSION = Result.getOrThrow(SchemaVersioning.parseResult("1.0.0"));
const RUN_REPORT_FILE_BASENAME = SchemaVersioning.fileName(RUN_REPORT_FILE_NAME, RUN_REPORT_FILE_VERSION);

const runReportFileTargetAt = (path: string): SchemaTarget =>
	SchemaTarget.make({
		schema: RunReportFile,
		$id: RUN_REPORT_FILE_SCHEMA_URL,
		name: RUN_REPORT_FILE_NAME,
		version: RUN_REPORT_FILE_VERSION,
		path,
	});

/**
 * The `run.json` publication target: the `RunReportFile` envelope emitted
 * as a Draft-07 document at the URL `run.json`'s own `$schema` key names.
 * Committed inside the package so the document ships to npm consumers.
 */
export const runReportFileTarget: SchemaTarget = runReportFileTargetAt(
	`${packageRoot}schemas/${RUN_REPORT_FILE_BASENAME}`,
);

/**
 * The same document under the docs site's static tree, so
 * {@link RUN_REPORT_FILE_SCHEMA_URL} resolves once the site deploys. It is
 * a second generated target rather than a hand-copy, so drift between the
 * two files is a test failure instead of a silent 404 of stale content.
 */
export const runReportFileWebsiteTarget: SchemaTarget = runReportFileTargetAt(
	`${repoRoot}website/docs/public/schemas/${RUN_REPORT_FILE_BASENAME}`,
);

/** Every published document, in the order the runner reports them. */
export const schemaTargets: ReadonlyArray<SchemaTarget> = [runReportFileTarget, runReportFileWebsiteTarget];

const { argv } = process;

const PipelineLayer = Layer.mergeAll(SchemaFile.layer, SchemaValidator.layer).pipe(Layer.provide(NodeServices.layer));

const generate = Effect.gen(function* () {
	for (const result of yield* SchemaPipeline.run(schemaTargets)) {
		yield* Effect.log(
			result.outcome === "written" ? `written (${result.change}): ${result.path}` : `unchanged: ${result.path}`,
		);
	}
});

const check = Effect.gen(function* () {
	let stale = false;
	for (const result of yield* SchemaPipeline.check(schemaTargets)) {
		for (const finding of result.findings) {
			yield* Effect.log(`${finding.severity} [${finding.label}] ${finding.path}: ${finding.message}`);
		}
		if (result.blocked || result.contractBlocked || result.wouldWrite) {
			stale = true;
			yield* Effect.log(
				result.contractBlocked
					? `contract changed (bump the version): ${result.path}`
					: result.blocked
						? `blocked (${result.change}): ${result.path}`
						: `stale (${result.change}): run pnpm --filter @vitest-agent/sdk schemas:generate — ${result.path}`,
			);
		} else {
			yield* Effect.log(`current: ${result.path}`);
		}
	}
	if (stale) process.exitCode = 1;
});

if (argv[1] !== undefined && fileURLToPath(import.meta.url) === argv[1]) {
	await Effect.runPromise((argv.includes("--check") ? check : generate).pipe(Effect.provide(PipelineLayer)));
}
