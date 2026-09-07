/**
 * Schemas for Vitest 5 test annotations and test artifacts.
 *
 * Vocabulary (spec §4.1): a *test annotation* is a `context.annotate`
 * note; a *test artifact* is a `recordArtifact` payload. Neither is a
 * *TDD artifact* (`tdd_artifacts`), which is red/green evidence.
 */

import { Schema } from "effect";

/**
 * Source position a test annotation or test artifact points at.
 * @public
 */
export const TestArtifactLocation = Schema.Struct({
	file: Schema.String,
	line: Schema.Number,
	column: Schema.Number,
}).annotate({ identifier: "TestArtifactLocation" });
/** @public */
export type TestArtifactLocation = typeof TestArtifactLocation.Type;

/**
 * One attachment descriptor.
 *
 * `path` is the location Vitest already rewrote the attachment to
 * (usually under `.vitest/attachments/`) or an external `http(s)` URL —
 * vitest-agent never copies the file itself. `body` is populated only
 * for inline attachments under the 64 KiB cap; `byteSize` is always
 * recorded so a dangling path stays describable.
 * @public
 */
export const TestAttachment = Schema.Struct({
	contentType: Schema.optional(Schema.String),
	path: Schema.optional(Schema.String),
	body: Schema.optional(Schema.String),
	byteSize: Schema.Number,
}).annotate({ identifier: "TestAttachment" });
/** @public */
export type TestAttachment = typeof TestAttachment.Type;

/**
 * A test annotation as recorded by `context.annotate`.
 *
 * `type` is an arbitrary string — Vitest applies no enum
 * (`.repos/vitest/packages/vitest/src/runtime/runner/types.ts`).
 * @public
 */
export const TestAnnotation = Schema.Struct({
	type: Schema.String,
	message: Schema.String,
	location: Schema.optional(TestArtifactLocation),
	attachments: Schema.Array(TestAttachment),
}).annotate({ identifier: "TestAnnotation" });
/** @public */
export type TestAnnotation = typeof TestAnnotation.Type;

/**
 * A test artifact as recorded by `recordArtifact`.
 *
 * `data` is the JSON encoding of the artifact's custom fields, minus
 * `attachments` and `location` (both modelled separately). Artifacts
 * whose `type` starts with `internal:` are Vitest's own and are not
 * persisted.
 * @public
 */
export const TestArtifact = Schema.Struct({
	type: Schema.String,
	message: Schema.optional(Schema.String),
	data: Schema.optional(Schema.String),
	location: Schema.optional(TestArtifactLocation),
	attachments: Schema.Array(TestAttachment),
}).annotate({ identifier: "TestArtifact" });
/** @public */
export type TestArtifact = typeof TestArtifact.Type;
