/**
 * `test_errors` MCP tool — Schema-driven implementation.
 *
 * The Effect Schema `TestErrorsResult` is the canonical contract for
 * the tool's output. The same Schema:
 *   - types the procedure's return value;
 *   - drives `formatTestErrorsMarkdown` (input typed via `Schema.Type`);
 *   - composes into `TestErrorsAsMarkdown`, a one-way
 *     `Schema.transformOrFail` whose `encode` direction renders the
 *     markdown the text channel carries (decode is forbidden because
 *     markdown rendering is lossy);
 *   - bridges to zod via `effectToZodSchema` for the SDK's
 *     `outputSchema` field, so the structured shape we declare to MCP
 *     stays in lockstep with what the procedure actually emits.
 *
 * @packageDocumentation
 */

import { DataReader } from "@vitest-agent/sdk";
import { Effect, ParseResult, Schema } from "effect";
import { publicProcedure } from "../context.js";

/** One row in the structured `errors[]` array. */
export const TestErrorRow = Schema.Struct({
	id: Schema.Number.annotations({
		title: "test_errors.id",
		description:
			"Numeric primary key of this error row. Pass as `citedTestErrorId` when calling `hypothesis (action: record)`.",
	}),
	topStackFrameId: Schema.NullOr(Schema.Number).annotations({
		title: "stack_frames.id (top frame)",
		description:
			"`stack_frames.id` of the top frame (ordinal=0); `null` when no frames were captured. Pass as `citedStackFrameId` to `hypothesis (action: record)`.",
	}),
	name: Schema.NullOr(Schema.String).annotations({
		description:
			"Error class name (e.g. `AssertionError`, `TypeError`); `null` when the underlying throw provided no name.",
	}),
	message: Schema.String.annotations({ description: "Error message text as the test framework reported it." }),
	diff: Schema.NullOr(Schema.String).annotations({
		description:
			"Unified-diff representation of expected vs. actual when the assertion produced one; `null` otherwise.",
	}),
	actual: Schema.NullOr(Schema.String).annotations({
		description: "Actual value the assertion received, when captured.",
	}),
	expected: Schema.NullOr(Schema.String).annotations({
		description: "Expected value the assertion compared against, when captured.",
	}),
	stack: Schema.NullOr(Schema.String).annotations({
		description:
			"Newline-joined stack frames as the framework formatted them; structured frames live in `stack_frames`.",
	}),
	scope: Schema.Literal("test", "suite", "module", "unhandled").annotations({
		description:
			"Where the error fired: `test` (a single test case), `suite` (a `describe` setup), `module` (collection / import time), or `unhandled` (uncaught from a background context).",
	}),
	testFullName: Schema.NullOr(Schema.String).annotations({
		description: "Full hierarchical test name (`describe > it`); `null` for non-test scopes (`module`, `unhandled`).",
	}),
	moduleFile: Schema.NullOr(Schema.String).annotations({
		description: "Repo-relative path of the test module the error originated in.",
	}),
}).annotations({
	identifier: "TestErrorRow",
	title: "Test error row",
	description: "Single error captured during a test run, joined with stack frame and source-location context.",
});

/** Top-level structured payload — populates `structuredContent`. */
export const TestErrorsResult = Schema.Struct({
	project: Schema.String.annotations({
		title: "Project name",
		description: "Workspace project key the run was attributed to (e.g. `playground`, `@org/pkg`).",
		examples: ["playground", "@org/pkg"],
	}),
	errorName: Schema.optional(Schema.String).annotations({
		description: "Echo of the optional `errorName` filter the caller passed; absent when no filter was applied.",
	}),
	count: Schema.Number.annotations({ description: "Total error rows in `errors`." }),
	errors: Schema.Array(TestErrorRow).annotations({
		description:
			"Errors from the most recent test run for this project, optionally filtered by `errorName`. Empty when no errors matched.",
	}),
}).annotations({
	identifier: "TestErrorsResult",
	title: "test_errors result",
	description:
		"Structured payload of the `test_errors` MCP tool. Carries the cite-able test_errors.id and stack_frames.id values agents need for `hypothesis (action: record)`.",
});
export type TestErrorsResultType = Schema.Schema.Type<typeof TestErrorsResult>;

const TRUNCATION_LIMIT = 500;
const truncate = (s: string): { value: string; truncated: boolean } =>
	s.length <= TRUNCATION_LIMIT
		? { value: s, truncated: false }
		: { value: s.slice(0, TRUNCATION_LIMIT), truncated: true };

/**
 * Pure markdown renderer. Exposed so the formatter tests can exercise
 * it without rebuilding a `Schema.encode` runtime.
 */
export const formatTestErrorsMarkdown = (data: TestErrorsResultType): string => {
	if (data.errors.length === 0) return `No errors found for project \`${data.project}\`.`;

	const lines: string[] = [`# Test Errors — ${data.project}`, ""];

	for (const error of data.errors) {
		const name = error.name ?? "(unnamed)";
		const idTokens = `[testErrorId=${error.id}${error.topStackFrameId !== null ? ` topStackFrameId=${error.topStackFrameId}` : ""}]`;
		lines.push(`## ${name} ${idTokens}`);
		lines.push("");
		lines.push(`**Scope:** ${error.scope}`);
		if (error.testFullName !== null) lines.push(`**Test:** ${error.testFullName}`);
		if (error.moduleFile !== null) lines.push(`**File:** \`${error.moduleFile}\``);
		lines.push("");
		lines.push("**Cite-able IDs (for `hypothesis (action: record)`):**");
		lines.push(`- citedTestErrorId: ${error.id}`);
		if (error.topStackFrameId !== null) {
			lines.push(`- citedStackFrameId: ${error.topStackFrameId}`);
		} else {
			lines.push("- citedStackFrameId: (none — no stack frames recorded for this error)");
		}
		lines.push("");
		lines.push("**Message:**");
		lines.push(`> ${error.message.split("\n").join("\n> ")}`);

		if (error.diff !== null) {
			lines.push("");
			lines.push("**Diff:**");
			lines.push("```diff");
			const t = truncate(error.diff);
			lines.push(t.value);
			if (t.truncated) lines.push("... (truncated)");
			lines.push("```");
		}

		if (error.stack !== null && error.diff === null) {
			lines.push("");
			lines.push("**Stack:**");
			lines.push("```");
			const t = truncate(error.stack);
			lines.push(t.value);
			if (t.truncated) lines.push("... (truncated)");
			lines.push("```");
		}

		lines.push("");
	}

	return lines.join("\n");
};

/**
 * One-way codec: structured `TestErrorsResult` → markdown text.
 *
 * `Schema.transformOrFail`'s `decode` direction goes
 * `From.Type → To.Encoded`; in this transform `From = TestErrorsResult`
 * and `To = Schema.String`, so the resulting schema is
 * `Schema<string, TestErrorsResultType>` — its parsed Type is the
 * markdown string and its Encoded form is the structured row. That
 * means `Schema.decode(TestErrorsAsMarkdown)(data)` produces markdown
 * (the rendering direction) and `Schema.encode(...)` would attempt
 * the lossy reverse, which is forbidden here.
 *
 * Boundary callers should use
 * `Schema.decodeSync(TestErrorsAsMarkdown)(data)` to render. Test
 * suites can drive the same path without mocking anything — the
 * transform IS the rendering contract.
 */
export const TestErrorsAsMarkdown = Schema.transformOrFail(TestErrorsResult, Schema.String, {
	strict: true,
	decode: (data) => ParseResult.succeed(formatTestErrorsMarkdown(data)),
	encode: (text, _options, ast) =>
		ParseResult.fail(
			new ParseResult.Forbidden(
				ast,
				text,
				"TestErrorsAsMarkdown is one-way: markdown cannot be parsed back to TestErrorsResult. Consume the procedure's structured output (or MCP structuredContent) directly.",
			),
		),
});

export const testErrors = publicProcedure
	.input(
		Schema.standardSchemaV1(
			Schema.Struct({
				project: Schema.String,
				errorName: Schema.optional(Schema.String),
			}),
		),
	)
	.query(
		async ({ ctx, input }): Promise<TestErrorsResultType> =>
			ctx.runtime.runPromise(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					const errors = yield* reader.getErrors(input.project, input.errorName);
					return {
						project: input.project,
						...(input.errorName !== undefined && { errorName: input.errorName }),
						count: errors.length,
						errors,
					};
				}),
			),
	);
