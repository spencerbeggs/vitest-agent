/**
 * `commit_changes` MCP tool — Schema-driven implementation.
 *
 * @packageDocumentation
 */

import { Effect, ParseResult, Schema } from "effect";
import { DataReader } from "vitest-agent-sdk";
import { publicProcedure } from "../context.js";

const FileRow = Schema.Struct({
	filePath: Schema.String.annotations({ description: "Repo-relative path of the changed file." }),
	changeKind: Schema.Literal("added", "modified", "deleted", "renamed", "untracked-modified").annotations({
		description:
			"How the file changed in this commit (or `untracked-modified` for working-tree changes attributed to a commit).",
	}),
}).annotations({ identifier: "CommitFileRow" });

const CommitRow = Schema.Struct({
	sha: Schema.String.annotations({ description: "Full git commit SHA-1." }),
	parentSha: Schema.NullOr(Schema.String).annotations({
		description: "Parent commit SHA, or `null` for the root commit / when no parent was recorded.",
	}),
	message: Schema.NullOr(Schema.String).annotations({
		description: "Commit message subject + body, or `null` if not captured.",
	}),
	author: Schema.NullOr(Schema.String).annotations({
		description: "Commit author in `Name <email>` form when captured.",
	}),
	committedAt: Schema.NullOr(Schema.String).annotations({ description: "ISO-8601 commit timestamp." }),
	branch: Schema.NullOr(Schema.String).annotations({
		description: "Branch the commit was recorded on at hook fire time.",
	}),
	files: Schema.Array(FileRow).annotations({ description: "Files this commit changed, with per-file change kinds." }),
}).annotations({ identifier: "CommitRow" });

export const CommitChangesResult = Schema.Struct({
	filterSha: Schema.optional(Schema.String).annotations({
		description:
			"Echo of the optional `sha` filter the caller passed; absent when no filter was applied (recent commits returned).",
	}),
	count: Schema.Number.annotations({ description: "Number of commit rows returned." }),
	commits: Schema.Array(CommitRow).annotations({
		description: "Matching commits, newest first when `sha` was omitted; up to 20 rows.",
	}),
}).annotations({
	identifier: "CommitChangesResult",
	title: "commit_changes result",
	description: "Commit metadata + per-file changes captured by the post-commit Bash hook.",
});
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

export const CommitChangesAsMarkdown = Schema.transformOrFail(CommitChangesResult, Schema.String, {
	strict: true,
	decode: (data) => ParseResult.succeed(formatCommitChangesMarkdown(data)),
	encode: (text, _options, ast) =>
		ParseResult.fail(
			new ParseResult.Forbidden(
				ast,
				text,
				"CommitChangesAsMarkdown is one-way: markdown cannot be parsed back to CommitChangesResult.",
			),
		),
});

export const commitChanges = publicProcedure
	.input(Schema.standardSchemaV1(Schema.Struct({ sha: Schema.optional(Schema.String) })))
	.query(
		async ({ ctx, input }): Promise<CommitChangesResultType> =>
			ctx.runtime.runPromise(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					const entries = yield* reader.getCommitChanges(input.sha);
					return {
						...(input.sha !== undefined && { filterSha: input.sha }),
						count: entries.length,
						commits: entries,
					};
				}),
			),
	);
