// Post-2.0 incremental migration (repo CLAUDE.md, spec §4.4).
//
// `test_annotations`, `test_artifacts` and `attachments` shipped in
// `0001_initial` with zero readers and zero writers. Phase 2 gives them
// writers, and two of the shapes were wrong for Vitest 5:
//
//   - `test_annotations.type` had CHECK (type IN ('notice','warning','error')),
//     but a Vitest annotation `type` is an arbitrary string
//     (.repos/vitest/packages/vitest/src/runtime/runner/types.ts, TestAnnotation).
//   - `test_annotations` carried three inline `attachment_*` columns even
//     though the sibling `attachments` table already models the 1:N.
//   - `test_artifacts` had no column for an artifact's custom fields.
//   - `attachments` recorded no size, so a dangling `.vitest/attachments`
//     path was not describable after the directory was cleaned, and no
//     encoding, so an inline `body` could not be decoded back (Vitest
//     treats a string body as base64 unless `bodyEncoding` is `"utf-8"`).
//
// The two annotation tables were dead, so the table is dropped and
// recreated rather than patched column by column. `test_artifacts` and
// `attachments` are widened in place with ALTER TABLE.

import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";

/** @internal */
const migration = Effect.gen(function* () {
	const sql = yield* SqlClient;

	yield* sql`DROP INDEX IF EXISTS idx_test_annotations_case`;
	yield* sql`DROP INDEX IF EXISTS idx_test_annotations_type`;
	yield* sql`DROP TABLE IF EXISTS test_annotations`;

	yield* sql`
		CREATE TABLE test_annotations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			test_case_id INTEGER NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
			type TEXT NOT NULL,
			message TEXT NOT NULL,
			location_file_id INTEGER REFERENCES files(id),
			location_line INTEGER,
			location_column INTEGER
		)
	`;
	yield* sql`CREATE INDEX idx_test_annotations_case ON test_annotations(test_case_id)`;
	yield* sql`CREATE INDEX idx_test_annotations_type ON test_annotations(type)`;

	// JSON of the artifact's custom fields, minus `attachments` and
	// `location` (both modelled relationally).
	yield* sql`ALTER TABLE test_artifacts ADD COLUMN data TEXT`;

	// Recorded for every attachment, inline or path-referenced, so a
	// dangling `.vitest/attachments` path is still describable.
	yield* sql`ALTER TABLE attachments ADD COLUMN byte_size INTEGER`;

	// How to read an inline `body`. Vitest treats a string body as base64
	// unless the attachment says `utf-8`.
	yield* sql`ALTER TABLE attachments ADD COLUMN body_encoding TEXT`;
});

/** @public */
export default migration;
