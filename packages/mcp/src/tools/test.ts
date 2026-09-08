/**
 * Consolidated `test` MCP tool — Schema-driven implementation.
 *
 * Replaces `test_list`, `test_get`, and `test_for_file` with one
 * tool keyed on `action`. Result variants discriminate on
 * `inventoryKind` so a single Effect Schema describes every shape
 * the tool can emit.
 *
 * @packageDocumentation
 */

import type { PersistedAttachment } from "@vitest-agent/sdk";
import { DataReader } from "@vitest-agent/sdk";
import { Effect, Match, Option, Schema, SchemaGetter } from "effect";
import { publicProcedure } from "../context.js";
import { collectProjectRows, resolveProjectTargets } from "./_project-groups.js";

const TestRowSchema = Schema.Struct({
	id: Schema.Number,
	fullName: Schema.String,
	state: Schema.String,
	duration: Schema.NullOr(Schema.Number),
	module: Schema.String,
	classification: Schema.NullOr(Schema.String),
}).annotate({ identifier: "TestListRow" });

const TestErrorRowMini = Schema.Struct({
	name: Schema.NullOr(Schema.String),
	message: Schema.String,
	diff: Schema.NullOr(Schema.String),
	stack: Schema.NullOr(Schema.String),
}).annotate({ identifier: "TestGetErrorRow" });

const TestRunRow = Schema.Struct({
	state: Schema.Literals(["passed", "failed"]),
	timestamp: Schema.String,
}).annotate({ identifier: "TestGetRunRow" });

const TestListGroup = Schema.Struct({ project: Schema.String, tests: Schema.Array(TestRowSchema) });
const TestListResult = Schema.Struct({
	action: Schema.Literal("list"),
	count: Schema.Number,
	groups: Schema.Array(TestListGroup),
}).annotate({ identifier: "TestList" });

const TestGetFound = Schema.Struct({
	action: Schema.Literal("get"),
	found: Schema.Literal(true),
	project: Schema.String,
	test: TestRowSchema,
	errors: Schema.Array(TestErrorRowMini),
	runs: Schema.Array(TestRunRow),
}).annotate({ identifier: "TestGetFound" });

const TestGetMissing = Schema.Struct({
	action: Schema.Literal("get"),
	found: Schema.Literal(false),
	project: Schema.String,
	fullName: Schema.String,
	/**
	 * `true` when the lookup failed *because* the name matched more than
	 * one module in the project's latest run and no `modulePath` was
	 * supplied to disambiguate (issue #243) — as opposed to the name
	 * simply not existing.
	 */
	ambiguous: Schema.optional(Schema.Boolean),
	/** The module paths a `fullName` matched when `ambiguous` is `true`. */
	candidateModules: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "TestGetMissing" });

const TestForFileResult = Schema.Struct({
	action: Schema.Literal("for_file"),
	filePath: Schema.String,
	count: Schema.Number,
	testFiles: Schema.Array(Schema.String),
}).annotate({ identifier: "TestForFile" });

const TestForTagResult = Schema.Struct({
	action: Schema.Literal("for_tag"),
	tag: Schema.String,
	count: Schema.Number,
	groups: Schema.Array(TestListGroup),
}).annotate({ identifier: "TestForTag" });

const AttachmentDescriptor = Schema.Struct({
	contentType: Schema.optional(Schema.String),
	path: Schema.optional(Schema.String),
	byteSize: Schema.NullOr(Schema.Number),
	/** Present only for inline attachments under the 64 KiB persistence cap. */
	body: Schema.optional(Schema.String),
	/** How to read `body`. Absent when nothing was stored inline. */
	bodyEncoding: Schema.optional(Schema.Literals(["base64", "utf-8"])),
}).annotate({ identifier: "TestAttachmentDescriptor" });

/**
 * Inline bodies are opt-in and budgeted. The 64 KiB persistence cap is
 * per attachment, so a test with many attachments could still flood an
 * agent's context; `maxBytes` (default 0) is the total byte budget for
 * every body in one response. Attachments are walked in order and each
 * body is charged its recorded `byteSize` (falling back to the stored
 * string's length when the row carries none). A body that would take
 * the running total past the budget is dropped along with its
 * `bodyEncoding`; the descriptor half — `contentType`, `path`,
 * `byteSize` — always survives.
 */
const applyBodyBudget = <A extends { readonly attachments: ReadonlyArray<PersistedAttachment> }>(
	rows: ReadonlyArray<A>,
	maxBytes: number,
): Array<A> => {
	let spent = 0;
	return rows.map((row) => ({
		...row,
		attachments: row.attachments.map((attachment) => {
			const { body, bodyEncoding, ...descriptor } = attachment;
			if (body === undefined) return descriptor;
			const cost = attachment.byteSize ?? body.length;
			if (spent + cost > maxBytes) return descriptor;
			spent += cost;
			return { ...descriptor, body, ...(bodyEncoding !== undefined && { bodyEncoding }) };
		}),
	}));
};

const AnnotationRowSchema = Schema.Struct({
	id: Schema.Number,
	type: Schema.String,
	message: Schema.String,
	location: Schema.optional(Schema.Struct({ file: Schema.String, line: Schema.Number, column: Schema.Number })),
	attachments: Schema.Array(AttachmentDescriptor),
}).annotate({ identifier: "TestAnnotationRow" });

const ArtifactRowSchema = Schema.Struct({
	id: Schema.Number,
	type: Schema.String,
	message: Schema.NullOr(Schema.String),
	data: Schema.NullOr(Schema.String),
	location: Schema.optional(Schema.Struct({ file: Schema.String, line: Schema.Number, column: Schema.Number })),
	attachments: Schema.Array(AttachmentDescriptor),
}).annotate({ identifier: "TestArtifactRow" });

const TestAnnotationsResult = Schema.Struct({
	action: Schema.Literal("annotations"),
	project: Schema.String,
	fullName: Schema.String,
	count: Schema.Number,
	annotations: Schema.Array(AnnotationRowSchema),
}).annotate({ identifier: "TestAnnotations" });

const TestArtifactsResult = Schema.Struct({
	action: Schema.Literal("artifacts"),
	project: Schema.String,
	fullName: Schema.String,
	count: Schema.Number,
	artifacts: Schema.Array(ArtifactRowSchema),
}).annotate({ identifier: "TestArtifacts" });

export const TestResult = Schema.Union([
	TestListResult,
	TestGetFound,
	TestGetMissing,
	TestForFileResult,
	TestForTagResult,
	TestAnnotationsResult,
	TestArtifactsResult,
]).annotate({
	identifier: "TestResult",
	title: "test result",
	description:
		"Discriminate on `action`. `get` further discriminates on `found`. `list`, `for_file`, `for_tag`, `annotations`, and `artifacts` all carry counted arrays — `list` and `for_tag` group by project; `annotations` and `artifacts` are scoped to one test and return attachment descriptors — an inline `body` comes back only when `maxBytes` is passed and the running total stays inside it.",
});
export type TestResultType = Schema.Schema.Type<typeof TestResult>;

export const formatTestMarkdown = (data: TestResultType): string => {
	if (data.action === "list") {
		if (data.count === 0) {
			return "No tests found. Run run_tests({}) to execute tests and populate the database.";
		}
		const lines: string[] = ["## Tests", ""];
		for (const g of data.groups) {
			lines.push(
				`### ${g.project}`,
				"",
				"| ID | Full Name | State | Duration | Module | Classification |",
				"| --- | --- | --- | --- | --- | --- |",
			);
			for (const t of g.tests) {
				const duration = t.duration !== null ? `${t.duration}ms` : "—";
				const classification = t.classification ?? "—";
				lines.push(`| ${t.id} | ${t.fullName} | ${t.state} | ${duration} | ${t.module} | ${classification} |`);
			}
			lines.push("");
		}
		return lines.join("\n").trimEnd();
	}
	if (data.action === "get") {
		if (!data.found) {
			if (data.ambiguous === true) {
				const modules = data.candidateModules ?? [];
				return [
					`Ambiguous test name: \`${data.fullName}\` matches ${modules.length} modules in project \`${data.project}\`.`,
					"",
					...modules.map((m) => `- \`${m}\``),
					"",
					`Re-run with a modulePath, e.g. test({ action: "get", fullName: "${data.fullName}", modulePath: "${modules[0] ?? ""}" }).`,
				].join("\n");
			}
			return `Test not found: \`${data.fullName}\`\n\nUse test({ action: "list" }) to discover available tests (format: "Suite > test name").`;
		}
		const t = data.test;
		const lines: string[] = [
			`# Test: ${t.fullName}`,
			"",
			"## Details",
			"",
			"| Field | Value |",
			"| --- | --- |",
			`| State | ${t.state} |`,
			`| Duration | ${t.duration !== null ? `${t.duration}ms` : "—"} |`,
			`| Module | \`${t.module}\` |`,
			`| Classification | ${t.classification ?? "—"} |`,
			"",
		];
		if (data.errors.length > 0) {
			lines.push("## Errors", "");
			for (const err of data.errors) {
				lines.push(`**${err.name ?? "(unnamed)"}**`);
				lines.push(`> ${err.message.split("\n").join("\n> ")}`);
				if (err.diff !== null) {
					lines.push("", "```diff", err.diff.slice(0, 1000));
					if (err.diff.length > 1000) lines.push(`... (truncated, ${err.diff.length} chars total)`);
					lines.push("```");
				}
				if (err.stack !== null && err.diff === null) {
					lines.push("", "```", err.stack.slice(0, 1000));
					if (err.stack.length > 1000) lines.push(`... (truncated, ${err.stack.length} chars total)`);
					lines.push("```");
				}
				lines.push("");
			}
		}
		if (data.runs.length > 0) {
			const viz = data.runs.map((r) => (r.state === "passed" ? "P" : "F")).join("");
			const passCount = data.runs.filter((r) => r.state === "passed").length;
			const failCount = data.runs.filter((r) => r.state === "failed").length;
			lines.push(
				"## Run History",
				"",
				`Pass rate: ${passCount}/${data.runs.length} (${Math.round((passCount / data.runs.length) * 100)}%)`,
				`Recent runs: \`${viz}\` (P=passed F=failed S=skipped, newest last)`,
			);
			if (failCount > 0 && passCount > 0) lines.push("Pattern: **flaky** (mixed pass/fail)");
			else if (failCount > 0) lines.push(`Pattern: **persistent failure** (${failCount} consecutive)`);
			lines.push("");
		}
		if (t.state === "failed") {
			lines.push(
				"## Next steps",
				"",
				`- Re-run: run_tests({ files: ["${t.module}"] })`,
				`- Use test({ action: "for_file", filePath: "${t.module}" }) to find related tests`,
				'- Use note({ action: "create", ... }) to record debugging findings',
			);
		}
		return lines.join("\n");
	}
	if (data.action === "for_tag") {
		if (data.count === 0) {
			return `No tests found tagged \`${data.tag}\`. Use \`inventory({ kind: "tag" })\` to discover available tags.`;
		}
		const lines: string[] = [
			`# Tests tagged \`${data.tag}\``,
			"",
			`Found ${data.count} test${data.count === 1 ? "" : "s"} across ${data.groups.length} project${data.groups.length === 1 ? "" : "s"}:`,
			"",
		];
		for (const g of data.groups) {
			lines.push(
				`### ${g.project}`,
				"",
				"| ID | Full Name | State | Duration | Module |",
				"| --- | --- | --- | --- | --- |",
			);
			for (const t of g.tests) {
				const duration = t.duration !== null ? `${t.duration}ms` : "—";
				lines.push(`| ${t.id} | ${t.fullName} | ${t.state} | ${duration} | ${t.module} |`);
			}
			lines.push("");
		}
		return lines.join("\n").trimEnd();
	}
	if (data.action === "annotations" || data.action === "artifacts") {
		const noun = data.action === "annotations" ? "test annotations" : "test artifacts";
		if (data.count === 0) return `No ${noun} recorded for \`${data.fullName}\`.`;
		const rows =
			data.action === "annotations"
				? data.annotations.map((a) => ({
						type: a.type,
						message: a.message,
						location: a.location,
						attachments: a.attachments,
					}))
				: data.artifacts.map((a) => ({
						type: a.type,
						// An artifact routinely carries its payload in `data` and no
						// message at all; rendering `—` there would hide the only
						// content the row has.
						message: a.message ?? a.data,
						location: a.location,
						attachments: a.attachments,
					}));
		// An artifact's `data` blob and a multi-line annotation both have to
		// survive a single table cell: newlines and pipes would break the
		// row, and an unbounded blob would swamp the agent's context. The
		// structured payload carries the untouched value.
		const cell = (value: string): string => {
			const flat = value.split("\n").join(" ").split("|").join("\\|");
			return flat.length > 200 ? `${flat.slice(0, 200)}… (truncated)` : flat;
		};
		const lines: string[] = [
			`# ${data.action === "annotations" ? "Annotations" : "Artifacts"} for \`${data.fullName}\``,
			"",
			`Project: \`${data.project}\` — ${data.count} row${data.count === 1 ? "" : "s"}.`,
			"",
			"| Type | Message | Location | Attachments |",
			"| --- | --- | --- | --- |",
		];
		for (const row of rows) {
			const location = row.location ? `\`${row.location.file}:${row.location.line}:${row.location.column}\`` : "—";
			const attachments =
				row.attachments.length === 0
					? "—"
					: row.attachments
							.map((att) => {
								const label = cell(att.path ?? att.contentType ?? "(inline)");
								const size = att.byteSize !== null ? ` (${att.byteSize} bytes)` : "";
								return `\`${label}\`${size}`;
							})
							.join(", ");
			const message = row.message === null ? "—" : cell(row.message);
			lines.push(`| ${row.type} | ${message} | ${location} | ${attachments} |`);
		}
		return lines.join("\n");
	}
	// for_file
	if (data.count === 0) {
		return `No test modules found covering \`${data.filePath}\`. Run run_tests({}) to populate the database, or check the file path.`;
	}
	const lines: string[] = [
		`# Tests for \`${data.filePath}\``,
		"",
		`Found ${data.count} test module${data.count === 1 ? "" : "s"}:`,
		"",
	];
	for (const f of data.testFiles) lines.push(`- \`${f}\``);
	return lines.join("\n");
};

export const TestAsMarkdown = TestResult.pipe(
	Schema.decodeTo(Schema.String, {
		decode: SchemaGetter.transform((data) => formatTestMarkdown(data)),
		encode: SchemaGetter.forbidden(() => "TestAsMarkdown is one-way."),
	}),
);

const ListVariant = Schema.Struct({
	action: Schema.Literal("list"),
	project: Schema.optional(Schema.String),
	state: Schema.optional(Schema.String),
	module: Schema.optional(Schema.String),
	limit: Schema.optional(Schema.Number),
});

const GetVariant = Schema.Struct({
	action: Schema.Literal("get"),
	fullName: Schema.String,
	project: Schema.optional(Schema.String),
	modulePath: Schema.optional(Schema.String).annotate({
		description: "Exact module_path match — disambiguates a fullName that exists in more than one test file.",
	}),
});

const ForFileVariant = Schema.Struct({
	action: Schema.Literal("for_file"),
	filePath: Schema.String,
});

const ForTagVariant = Schema.Struct({
	action: Schema.Literal("for_tag"),
	tag: Schema.String,
	project: Schema.optional(Schema.String),
});

const AnnotationsVariant = Schema.Struct({
	action: Schema.Literal("annotations"),
	fullName: Schema.String,
	project: Schema.optional(Schema.String),
	modulePath: Schema.optional(Schema.String).annotate({
		description: "Exact module_path match — disambiguates a fullName that exists in more than one test file.",
	}),
	maxBytes: Schema.optional(
		Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
			description:
				"Total byte budget for inline attachment bodies across the whole response. Must be a non-negative integer. Defaults to 0 — descriptors only, no bodies.",
		}),
	),
});

const ArtifactsVariant = Schema.Struct({
	action: Schema.Literal("artifacts"),
	fullName: Schema.String,
	project: Schema.optional(Schema.String),
	modulePath: Schema.optional(Schema.String).annotate({
		description: "Exact module_path match — disambiguates a fullName that exists in more than one test file.",
	}),
	maxBytes: Schema.optional(
		Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
			description:
				"Total byte budget for inline attachment bodies across the whole response. Must be a non-negative integer. Defaults to 0 — descriptors only, no bodies.",
		}),
	),
});

const TestInput = Schema.Union([
	ListVariant,
	GetVariant,
	ForFileVariant,
	ForTagVariant,
	AnnotationsVariant,
	ArtifactsVariant,
]);

/**
 * Single source of truth for the `test` tool's `action` discriminant,
 * consumed by `server.ts`'s served `z.enum(...)` so the MCP-SDK-side
 * registration cannot drift from this tRPC input union (issue #335).
 */
export const TEST_ACTIONS = ["list", "get", "for_file", "for_tag", "annotations", "artifacts"] as const;
type TestAction = Schema.Schema.Type<typeof TestInput>["action"];
// Compile-time equality check, both directions: fails to typecheck if
// TEST_ACTIONS is missing a variant present in TestInput, or contains a
// literal TestInput does not declare.
type _AssertTestActions = TestAction extends (typeof TEST_ACTIONS)[number]
	? (typeof TEST_ACTIONS)[number] extends TestAction
		? true
		: never
	: never;
const _assertTestActions: _AssertTestActions = true;
void _assertTestActions;

export const test = publicProcedure
	.input(Schema.toStandardSchemaV1(TestInput))
	.query(async ({ ctx, input }): Promise<TestResultType> => {
		return ctx.runtime.runPromise(
			Match.value(input).pipe(
				Match.discriminatorsExhaustive("action")({
					list: (variant) =>
						Effect.gen(function* () {
							const reader = yield* DataReader;
							const opts: { state?: string; module?: string; limit?: number } = {};
							if (variant.state !== undefined) opts.state = variant.state;
							if (variant.module !== undefined) opts.module = variant.module;
							if (variant.limit !== undefined) opts.limit = variant.limit;
							const targets = yield* resolveProjectTargets(variant.project, () => reader.getRunsByProject());
							const grouped = yield* collectProjectRows(targets, (project) => reader.listTests(project, opts));
							const groups: Array<Schema.Schema.Type<typeof TestListGroup>> = grouped.groups.map((group) => ({
								project: group.project,
								tests: group.rows,
							}));
							return { action: "list" as const, count: grouped.total, groups };
						}),
					get: (variant) =>
						Effect.gen(function* () {
							const reader = yield* DataReader;
							const candidates: ReadonlyArray<string> = variant.project
								? [variant.project]
								: yield* reader.getRunsByProject().pipe(Effect.map((rs) => rs.map((r) => r.project)));
							for (const project of candidates) {
								// `full_name` is not file-qualified (Decision D20), so the
								// same name can live in several modules of one run. Refuse
								// to guess: without a `modulePath` an ambiguous name gets
								// the absent shape naming the candidates instead of an
								// arbitrary variant (issue #243, follow-up to #241).
								const modules = yield* reader.getTestModulesByFullName(project, variant.fullName);
								if (modules.length === 0) continue;
								if (variant.modulePath === undefined && modules.length > 1) {
									return {
										action: "get" as const,
										found: false as const,
										project,
										fullName: variant.fullName,
										ambiguous: true,
										candidateModules: modules,
									};
								}
								const testOpt = yield* reader.getTestByFullName(project, variant.fullName, {
									...(variant.modulePath !== undefined && { modulePath: variant.modulePath }),
								});
								if (Option.isNone(testOpt)) continue;
								const errors = yield* reader.getErrors(project);
								const matchingErrors = errors
									.filter((e) => e.testFullName === variant.fullName && e.moduleFile === testOpt.value.module)
									.map((e) => ({ name: e.name, message: e.message, diff: e.diff, stack: e.stack }));
								const history = yield* reader.getHistory(project, {
									testName: variant.fullName,
									modulePath: testOpt.value.module,
								});
								const testHistory = history.tests.find((entry) => entry.fullName === variant.fullName);
								return {
									action: "get" as const,
									found: true as const,
									project,
									test: testOpt.value,
									errors: matchingErrors,
									runs: testHistory ? testHistory.runs : [],
								};
							}
							return {
								action: "get" as const,
								found: false as const,
								project: variant.project ?? candidates[0] ?? "",
								fullName: variant.fullName,
							};
						}),
					for_file: (variant) =>
						Effect.gen(function* () {
							const reader = yield* DataReader;
							const testFiles = yield* reader.getTestsForFile(variant.filePath);
							return {
								action: "for_file" as const,
								filePath: variant.filePath,
								count: testFiles.length,
								testFiles,
							};
						}),
					for_tag: (variant) =>
						Effect.gen(function* () {
							const reader = yield* DataReader;
							// Mirrors the `list` action: when project is omitted, iterate
							// every known project's latest run and emit a per-project group
							// for each non-empty result; when supplied, return at most one
							// group.
							const targets = yield* resolveProjectTargets(variant.project, () => reader.getRunsByProject());
							const grouped = yield* collectProjectRows(targets, (project) =>
								reader.listTestsForTag(variant.tag, { project }),
							);
							const groups: Array<Schema.Schema.Type<typeof TestListGroup>> = grouped.groups.map((group) => ({
								project: group.project,
								tests: group.rows,
							}));
							return { action: "for_tag" as const, tag: variant.tag, count: grouped.total, groups };
						}),
					annotations: (variant) =>
						Effect.gen(function* () {
							const reader = yield* DataReader;
							const project =
								variant.project ?? (yield* reader.getRunsByProject().pipe(Effect.map((rs) => rs[0]?.project ?? "")));
							const rows = yield* reader.getAnnotationsForTest(project, variant.fullName, {
								...(variant.modulePath !== undefined && { modulePath: variant.modulePath }),
							});
							const annotations = applyBodyBudget(rows, variant.maxBytes ?? 0);
							return {
								action: "annotations" as const,
								project,
								fullName: variant.fullName,
								count: annotations.length,
								annotations,
							};
						}),
					artifacts: (variant) =>
						Effect.gen(function* () {
							const reader = yield* DataReader;
							const project =
								variant.project ?? (yield* reader.getRunsByProject().pipe(Effect.map((rs) => rs[0]?.project ?? "")));
							const rows = yield* reader.getArtifactsForTest(project, variant.fullName, {
								...(variant.modulePath !== undefined && { modulePath: variant.modulePath }),
							});
							const artifacts = applyBodyBudget(rows, variant.maxBytes ?? 0);
							return {
								action: "artifacts" as const,
								project,
								fullName: variant.fullName,
								count: artifacts.length,
								artifacts,
							};
						}),
				}),
			),
		);
	});
