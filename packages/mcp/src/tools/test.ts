// Consolidated `test` MCP tool — Schema-driven implementation.
//
// Replaces `test_list`, `test_get`, and `test_for_file` with one
// tool keyed on `action`. Result variants discriminate on
// `inventoryKind` so a single Effect Schema describes every shape
// the tool can emit.

import type { PersistedAttachment } from "@vitest-agent/engine";
import { DataReader } from "@vitest-agent/engine";
import { Effect, Match, Option, Schema } from "effect";
import { Tool } from "effect/unstable/ai";
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
 * body is charged the byte length of the string that will actually be
 * placed in the response — NOT its recorded `byteSize`, which is the
 * decoded size and undercounts a base64 body by a quarter (issue #393),
 * and not `String.length`, which counts UTF-16 code units and undercounts
 * multibyte utf-8. A body
 * that would take the running total past the budget is dropped along
 * with its `bodyEncoding`; the descriptor half — `contentType`, `path`,
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
			const cost = Buffer.byteLength(body, "utf-8");
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

/**
 * The `test` tool's success payload.
 *
 * @public
 */
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
/**
 * The decoded {@link TestResult}.
 *
 * @public
 */
export type TestResultType = Schema.Schema.Type<typeof TestResult>;

const ListVariant = Schema.Struct({
	action: Schema.Literal("list"),
	project: Schema.optionalKey(Schema.String),
	state: Schema.optionalKey(Schema.String).annotate({ description: "list: filter by state" }),
	module: Schema.optionalKey(Schema.String).annotate({ description: "list: filter by module path" }),
	limit: Schema.optionalKey(Schema.Finite).annotate({ description: "list: max rows to return" }),
});

const GetVariant = Schema.Struct({
	action: Schema.Literal("get"),
	fullName: Schema.String.annotate({ description: "get / annotations / artifacts: full test name" }),
	project: Schema.optionalKey(Schema.String),
	modulePath: Schema.optionalKey(Schema.String).annotate({
		description: "Exact module_path match — disambiguates a fullName that exists in more than one test file.",
	}),
});

const ForFileVariant = Schema.Struct({
	action: Schema.Literal("for_file"),
	filePath: Schema.String.annotate({ description: "for_file: source file path" }),
});

const ForTagVariant = Schema.Struct({
	action: Schema.Literal("for_tag"),
	tag: Schema.String.annotate({ description: "for_tag: tag name" }),
	project: Schema.optionalKey(Schema.String),
});

const AnnotationsVariant = Schema.Struct({
	action: Schema.Literal("annotations"),
	fullName: Schema.String.annotate({ description: "get / annotations / artifacts: full test name" }),
	project: Schema.optionalKey(Schema.String),
	modulePath: Schema.optionalKey(Schema.String).annotate({
		description: "Exact module_path match — disambiguates a fullName that exists in more than one test file.",
	}),
	maxBytes: Schema.optionalKey(
		Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
			description:
				"Total byte budget for inline attachment bodies across the whole response. Must be a non-negative integer. Defaults to 0 — descriptors only, no bodies.",
		}),
	),
});

const ArtifactsVariant = Schema.Struct({
	action: Schema.Literal("artifacts"),
	fullName: Schema.String.annotate({ description: "get / annotations / artifacts: full test name" }),
	project: Schema.optionalKey(Schema.String),
	modulePath: Schema.optionalKey(Schema.String).annotate({
		description: "Exact module_path match — disambiguates a fullName that exists in more than one test file.",
	}),
	maxBytes: Schema.optionalKey(
		Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
			description:
				"Total byte budget for inline attachment bodies across the whole response. Must be a non-negative integer. Defaults to 0 — descriptors only, no bodies.",
		}),
	),
});

/**
 * The `test` tool's parameters — a union discriminated on `action`. The
 * served JSON Schema is a `oneOf` over the variants with
 * `x-discriminator: "action"`.
 *
 * @public
 */
export const TestInput = Schema.Union([
	ListVariant,
	GetVariant,
	ForFileVariant,
	ForTagVariant,
	AnnotationsVariant,
	ArtifactsVariant,
]);
/**
 * The decoded {@link TestInput}.
 *
 * @public
 */
export type TestInputType = Schema.Schema.Type<typeof TestInput>;

/**
 * Single source of truth for the `test` tool's `action` discriminant.
 * `served-enum-drift.test.ts` asserts the served `oneOf` members match
 * this tuple exactly, so the wire enum cannot drift from the input union
 * (issue #335).
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

/**
 * Handler for {@link testTool}.
 *
 * @public
 */
export const handleTest = (input: TestInputType): Effect.Effect<TestResultType, never, DataReader> =>
	Match.value(input)
		.pipe(
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
		)
		.pipe(Effect.orDie);

/**
 * The Effect-native `test` tool.
 *
 * @public
 */
export const testTool = Tool.make("test", {
	description:
		"Use to inspect tests, with an action discriminator: action='list' (project?, state?, module?, limit?) returns matching tests; action='get' (fullName, project?, modulePath?) returns details + errors + run history — a fullName that exists in more than one module returns found=false with ambiguous=true and candidateModules[], so pass modulePath to disambiguate; action='for_file' (filePath) returns test modules covering a source file; action='for_tag' (tag, project?) returns tests carrying a tag, grouped by project; action='annotations' (fullName, project?, modulePath?) returns the test annotations the author recorded via context.annotate; action='artifacts' (fullName, project?, modulePath?) returns the test artifacts recorded for the test — both return attachment descriptors (contentType, path, byteSize) and omit inline bodies unless maxBytes (a non-negative integer byte budget for the whole response, default 0) is passed, and neither has anything to do with TDD artifacts (see tdd_artifact_list). structuredContent carries the typed payload (discriminate on `action`, then on `found` for get).",
	parameters: TestInput,
	success: TestResult,
	dependencies: [DataReader],
})
	.annotate(Tool.Title, "Test")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)
	.annotate(Tool.Idempotent, true);
