// `commit_changes` MCP tool — Schema-driven implementation.

import { DataReader } from "@vitest-agent/engine";
import { Effect, Schema, SchemaGetter } from "effect";
import { Tool } from "effect/unstable/ai";
import { RenderText } from "../annotations.js";

const FileRow = Schema.Struct({
	filePath: Schema.String.annotate({ description: "Repo-relative path of the changed file." }),
	changeKind: Schema.Literals(["added", "modified", "deleted", "renamed", "untracked-modified"]).annotate({
		description:
			"How the file changed in this commit (or `untracked-modified` for working-tree changes attributed to a commit).",
	}),
}).annotate({ identifier: "CommitFileRow" });

const CommitRow = Schema.Struct({
	sha: Schema.String.annotate({ description: "Full git commit SHA-1." }),
	parentSha: Schema.NullOr(Schema.String).annotate({
		description: "Parent commit SHA, or `null` for the root commit / when no parent was recorded.",
	}),
	message: Schema.NullOr(Schema.String).annotate({
		description: "Commit message subject + body, or `null` if not captured.",
	}),
	author: Schema.NullOr(Schema.String).annotate({
		description: "Commit author in `Name <email>` form when captured.",
	}),
	committedAt: Schema.NullOr(Schema.String).annotate({ description: "ISO-8601 commit timestamp." }),
	branch: Schema.NullOr(Schema.String).annotate({
		description: "Branch the commit was recorded on at hook fire time.",
	}),
	files: Schema.Array(FileRow).annotate({ description: "Files this commit changed, with per-file change kinds." }),
}).annotate({ identifier: "CommitRow" });

/**
 * The `commit_changes` tool's success payload.
 *
 * @public
 */
export const CommitChangesResult = Schema.Struct({
	filterSha: Schema.optional(Schema.String).annotate({
		description:
			"Echo of the optional `sha` filter the caller passed; absent when no filter was applied (recent commits returned).",
	}),
	count: Schema.Finite.annotate({ description: "Number of commit rows returned." }),
	commits: Schema.Array(CommitRow).annotate({
		description: "Matching commits, newest first when `sha` was omitted; up to 20 rows.",
	}),
}).annotate({
	identifier: "CommitChangesResult",
	title: "commit_changes result",
	description: "Commit metadata + per-file changes captured by the post-commit Bash hook.",
});
/**
 * The decoded {@link CommitChangesResult}.
 *
 * @public
 */
export type CommitChangesResultType = Schema.Schema.Type<typeof CommitChangesResult>;

export const formatCommitChangesMarkdown = (data: CommitChangesResultType): string => {
	if (data.commits.length === 0) {
		return data.filterSha !== undefined
			? `No commit recorded with sha ${data.filterSha}.`
			: "No commits recorded yet. The PostToolUse hook on `git commit` populates this table.";
	}
	const lines: string[] = [];
	for (const e of data.commits) {
		lines.push(`## ${e.sha.slice(0, 8)} ${e.message ?? "(no message)"}`);
		if (e.author !== null) lines.push(`- Author: ${e.author}`);
		if (e.committedAt !== null) lines.push(`- When: ${e.committedAt}`);
		if (e.branch !== null) lines.push(`- Branch: ${e.branch}`);
		if (e.files.length > 0) {
			lines.push("- Changed files:");
			for (const f of e.files) lines.push(`  - \`${f.filePath}\` (${f.changeKind})`);
		}
		lines.push("");
	}
	return lines.join("\n").trim();
};

export const CommitChangesAsMarkdown = CommitChangesResult.pipe(
	Schema.decodeTo(Schema.String, {
		decode: SchemaGetter.transform((data) => formatCommitChangesMarkdown(data)),
		encode: SchemaGetter.forbidden(
			() => "CommitChangesAsMarkdown is one-way: markdown cannot be parsed back to CommitChangesResult.",
		),
	}),
);

/**
 * The `commit_changes` tool's parameters.
 *
 * @public
 */
export const CommitChangesInput = Schema.Struct({
	sha: Schema.optionalKey(Schema.String).annotate({
		description: "Specific commit sha to fetch; omit for recent commits",
	}),
});
/**
 * The decoded {@link CommitChangesInput}.
 *
 * @public
 */
export type CommitChangesInputType = Schema.Schema.Type<typeof CommitChangesInput>;

/**
 * Handler for {@link commitChangesTool}.
 *
 * @public
 */
export const handleCommitChanges = (
	input: CommitChangesInputType,
): Effect.Effect<CommitChangesResultType, never, DataReader> =>
	Effect.gen(function* () {
		const reader = yield* DataReader;
		const entries = yield* reader.getCommitChanges(input.sha);
		return {
			...(input.sha !== undefined && { filterSha: input.sha }),
			count: entries.length,
			commits: entries,
		};
	}).pipe(Effect.orDie);

/**
 * The Effect-native `commit_changes` tool.
 *
 * @public
 */
export const commitChangesTool = Tool.make("commit_changes", {
	description:
		"Use when you need commit metadata and changed files captured by the post-commit hook. Returns up to 20 most-recent when sha is omitted. Returns markdown in content[] and a typed JSON object in structuredContent ({ filterSha?, count, commits[] }).",
	parameters: CommitChangesInput,
	success: CommitChangesResult,
	dependencies: [DataReader],
})
	.annotate(Tool.Title, "Commit changes")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)
	.annotate(Tool.Idempotent, true)
	.annotate(RenderText, (encoded) => formatCommitChangesMarkdown(encoded as CommitChangesResultType));
