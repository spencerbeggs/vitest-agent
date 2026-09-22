// `test_errors` MCP tool — Schema-driven implementation.
//
// The Effect Schema `TestErrorsResult` is the canonical contract for
// the tool's output. The same Schema:
//   - types the handler's return value;
//   - is the `Tool.make` `success` schema, so the `outputSchema` served
//     to MCP stays in lockstep with what the handler actually emits.

import { DataReader } from "@vitest-agent/engine";
import { Effect, Schema } from "effect";
import { Tool } from "effect/unstable/ai";

/** One annotation attached to a failing test, surfaced with its error. */
export const TestErrorAnnotation = Schema.Struct({
	type: Schema.String.annotate({
		description: "Annotation type as the test author wrote it — an arbitrary string, not an enum.",
	}),
	message: Schema.String,
	location: Schema.optional(Schema.Struct({ file: Schema.String, line: Schema.Number, column: Schema.Number })),
}).annotate({ identifier: "TestErrorAnnotation" });

/** One row in the structured `errors[]` array. */
export const TestErrorRow = Schema.Struct({
	id: Schema.Finite.annotate({
		title: "test_errors.id",
		description:
			"Numeric primary key of this error row. Pass as `citedTestErrorId` when calling `hypothesis (action: record)`.",
	}),
	topStackFrameId: Schema.NullOr(Schema.Number).annotate({
		title: "stack_frames.id (top frame)",
		description:
			"`stack_frames.id` of the top frame (ordinal=0); `null` when no frames were captured. Pass as `citedStackFrameId` to `hypothesis (action: record)`.",
	}),
	name: Schema.NullOr(Schema.String).annotate({
		description:
			"Error class name (e.g. `AssertionError`, `TypeError`); `null` when the underlying throw provided no name.",
	}),
	message: Schema.String.annotate({ description: "Error message text as the test framework reported it." }),
	diff: Schema.NullOr(Schema.String).annotate({
		description:
			"Unified-diff representation of expected vs. actual when the assertion produced one; `null` otherwise.",
	}),
	actual: Schema.NullOr(Schema.String).annotate({
		description: "Actual value the assertion received, when captured.",
	}),
	expected: Schema.NullOr(Schema.String).annotate({
		description: "Expected value the assertion compared against, when captured.",
	}),
	stack: Schema.NullOr(Schema.String).annotate({
		description:
			"Newline-joined stack frames as the framework formatted them; structured frames live in `stack_frames`.",
	}),
	scope: Schema.Literals(["test", "suite", "module", "unhandled"]).annotate({
		description:
			"Where the error fired: `test` (a single test case), `suite` (a `describe` setup), `module` (collection / import time), or `unhandled` (uncaught from a background context).",
	}),
	testFullName: Schema.NullOr(Schema.String).annotate({
		description: "Full hierarchical test name (`describe > it`); `null` for non-test scopes (`module`, `unhandled`).",
	}),
	moduleFile: Schema.NullOr(Schema.String).annotate({
		description: "Repo-relative path of the test module the error originated in.",
	}),
	annotations: Schema.Array(TestErrorAnnotation).annotate({
		description:
			"Test annotations the author recorded on this test (`context.annotate`). Empty for non-test scopes and for tests with no annotations.",
	}),
}).annotate({
	identifier: "TestErrorRow",
	title: "Test error row",
	description: "Single error captured during a test run, joined with stack frame and source-location context.",
});

/**
 * The `test_errors` tool's success payload — populates `structuredContent`.
 *
 * @public
 */
export const TestErrorsResult = Schema.Struct({
	project: Schema.String.annotate({
		title: "Project name",
		description: "Workspace project key the run was attributed to (e.g. `playground`, `@org/pkg`).",
		examples: ["playground", "@org/pkg"],
	}),
	errorName: Schema.optional(Schema.String).annotate({
		description: "Echo of the optional `errorName` filter the caller passed; absent when no filter was applied.",
	}),
	count: Schema.Finite.annotate({ description: "Total error rows in `errors`." }),
	errors: Schema.Array(TestErrorRow).annotate({
		description:
			"Errors from the most recent test run for this project, optionally filtered by `errorName`. Empty when no errors matched.",
	}),
}).annotate({
	identifier: "TestErrorsResult",
	title: "test_errors result",
	description:
		"Structured payload of the `test_errors` MCP tool. Carries the cite-able test_errors.id and stack_frames.id values agents need for `hypothesis (action: record)`.",
});
/**
 * The decoded {@link TestErrorsResult}.
 *
 * @public
 */
export type TestErrorsResultType = Schema.Schema.Type<typeof TestErrorsResult>;
type TestErrorAnnotationType = Schema.Schema.Type<typeof TestErrorAnnotation>;

/**
 * The `test_errors` tool's parameters.
 *
 * @public
 */
export const TestErrorsInput = Schema.Struct({
	project: Schema.String.annotate({ description: "Project name (required)" }),
	errorName: Schema.optionalKey(Schema.String).annotate({ description: "Filter to a specific error name" }),
});
/**
 * The decoded {@link TestErrorsInput}.
 *
 * @public
 */
export type TestErrorsInputType = Schema.Schema.Type<typeof TestErrorsInput>;

/**
 * Handler for {@link testErrorsTool}.
 *
 * @public
 */
export const handleTestErrors = (input: TestErrorsInputType): Effect.Effect<TestErrorsResultType, never, DataReader> =>
	Effect.gen(function* () {
		const reader = yield* DataReader;
		const errors = yield* reader.getErrors(input.project, input.errorName);
		// One read per distinct (testFullName, moduleFile) pair: several
		// errors routinely share a test, and a non-test scope
		// (`module` / `unhandled`) has no test to annotate at all.
		const cache = new Map<string, ReadonlyArray<TestErrorAnnotationType>>();
		const rows: Array<Schema.Schema.Type<typeof TestErrorRow>> = [];
		for (const error of errors) {
			if (error.testFullName === null) {
				rows.push({ ...error, annotations: [] });
				continue;
			}
			const key = `${error.testFullName}\u0000${error.moduleFile ?? ""}`;
			let annotations = cache.get(key);
			if (annotations === undefined) {
				// Projected down to the declared shape: the reader row also
				// carries `id` and `attachments`, and an undeclared key would
				// fail the served structuredContent validation against the
				// outputSchema derived from `TestErrorRow`.
				annotations = (yield* reader.getAnnotationsForTest(input.project, error.testFullName, {
					...(error.moduleFile !== null && { modulePath: error.moduleFile }),
				})).map((a) => ({ type: a.type, message: a.message, ...(a.location && { location: a.location }) }));
				cache.set(key, annotations);
			}
			rows.push({ ...error, annotations });
		}
		return {
			project: input.project,
			...(input.errorName !== undefined && { errorName: input.errorName }),
			count: rows.length,
			errors: rows,
		};
	}).pipe(Effect.orDie);

/**
 * The Effect-native `test_errors` tool.
 *
 * @public
 */
export const testErrorsTool = Tool.make("test_errors", {
	description:
		"Use when a test fails and you need error detail, diffs, and the cite-able test_errors.id / stack_frames.id values needed by hypothesis (action: record). Returns a typed JSON object in structuredContent; read structuredContent.errors[].",
	parameters: TestErrorsInput,
	success: TestErrorsResult,
	dependencies: [DataReader],
})
	.annotate(Tool.Title, "Test errors")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)
	.annotate(Tool.Idempotent, true);
