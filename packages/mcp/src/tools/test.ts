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

import { DataReader } from "@vitest-agent/sdk";
import { Effect, Match, Option, ParseResult, Schema } from "effect";
import { publicProcedure } from "../context.js";

const TestRowSchema = Schema.Struct({
	id: Schema.Number,
	fullName: Schema.String,
	state: Schema.String,
	duration: Schema.NullOr(Schema.Number),
	module: Schema.String,
	classification: Schema.NullOr(Schema.String),
}).annotations({ identifier: "TestListRow" });

const TestErrorRowMini = Schema.Struct({
	name: Schema.NullOr(Schema.String),
	message: Schema.String,
	diff: Schema.NullOr(Schema.String),
	stack: Schema.NullOr(Schema.String),
}).annotations({ identifier: "TestGetErrorRow" });

const TestRunRow = Schema.Struct({
	state: Schema.Literal("passed", "failed"),
	timestamp: Schema.String,
}).annotations({ identifier: "TestGetRunRow" });

const TestListGroup = Schema.Struct({ project: Schema.String, tests: Schema.Array(TestRowSchema) });
const TestListResult = Schema.Struct({
	action: Schema.Literal("list"),
	count: Schema.Number,
	groups: Schema.Array(TestListGroup),
}).annotations({ identifier: "TestList" });

const TestGetFound = Schema.Struct({
	action: Schema.Literal("get"),
	found: Schema.Literal(true),
	project: Schema.String,
	test: TestRowSchema,
	errors: Schema.Array(TestErrorRowMini),
	runs: Schema.Array(TestRunRow),
}).annotations({ identifier: "TestGetFound" });

const TestGetMissing = Schema.Struct({
	action: Schema.Literal("get"),
	found: Schema.Literal(false),
	project: Schema.String,
	fullName: Schema.String,
}).annotations({ identifier: "TestGetMissing" });

const TestForFileResult = Schema.Struct({
	action: Schema.Literal("for_file"),
	filePath: Schema.String,
	count: Schema.Number,
	testFiles: Schema.Array(Schema.String),
}).annotations({ identifier: "TestForFile" });

const TestForTagResult = Schema.Struct({
	action: Schema.Literal("for_tag"),
	tag: Schema.String,
	count: Schema.Number,
	groups: Schema.Array(TestListGroup),
}).annotations({ identifier: "TestForTag" });

export const TestResult = Schema.Union(
	TestListResult,
	TestGetFound,
	TestGetMissing,
	TestForFileResult,
	TestForTagResult,
).annotations({
	identifier: "TestResult",
	title: "test result",
	description:
		"Discriminate on `action`. `get` further discriminates on `found`. `list`, `for_file`, and `for_tag` all carry counted arrays — `list` and `for_tag` group by project.",
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

export const TestAsMarkdown = Schema.transformOrFail(TestResult, Schema.String, {
	strict: true,
	decode: (data) => ParseResult.succeed(formatTestMarkdown(data)),
	encode: (text, _options, ast) => ParseResult.fail(new ParseResult.Forbidden(ast, text, "TestAsMarkdown is one-way.")),
});

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

const TestInput = Schema.Union(ListVariant, GetVariant, ForFileVariant, ForTagVariant);

export const test = publicProcedure
	.input(Schema.standardSchemaV1(TestInput))
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
							const targets: ReadonlyArray<{ project: string }> = variant.project
								? [{ project: variant.project }]
								: yield* reader.getRunsByProject().pipe(Effect.map((rs) => rs.map((r) => ({ project: r.project }))));
							const groups: Array<Schema.Schema.Type<typeof TestListGroup>> = [];
							let total = 0;
							for (const t of targets) {
								const tests = yield* reader.listTests(t.project, opts);
								if (tests.length > 0) {
									groups.push({ project: t.project, tests });
									total += tests.length;
								}
							}
							return { action: "list" as const, count: total, groups };
						}),
					get: (variant) =>
						Effect.gen(function* () {
							const reader = yield* DataReader;
							const candidates: ReadonlyArray<string> = variant.project
								? [variant.project]
								: yield* reader.getRunsByProject().pipe(Effect.map((rs) => rs.map((r) => r.project)));
							for (const project of candidates) {
								const testOpt = yield* reader.getTestByFullName(project, variant.fullName);
								if (Option.isNone(testOpt)) continue;
								const errors = yield* reader.getErrors(project);
								const matchingErrors = errors
									.filter((e) => e.testFullName === variant.fullName)
									.map((e) => ({ name: e.name, message: e.message, diff: e.diff, stack: e.stack }));
								const history = yield* reader.getHistory(project);
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
							const targets: ReadonlyArray<{ project: string }> = variant.project
								? [{ project: variant.project }]
								: yield* reader.getRunsByProject().pipe(Effect.map((rs) => rs.map((r) => ({ project: r.project }))));
							const groups: Array<Schema.Schema.Type<typeof TestListGroup>> = [];
							let total = 0;
							for (const t of targets) {
								const tests = yield* reader.listTestsForTag(variant.tag, { project: t.project });
								if (tests.length > 0) {
									groups.push({ project: t.project, tests });
									total += tests.length;
								}
							}
							return { action: "for_tag" as const, tag: variant.tag, count: total, groups };
						}),
				}),
			),
		);
	});
