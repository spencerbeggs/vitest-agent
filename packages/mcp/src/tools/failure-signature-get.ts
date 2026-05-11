/**
 * `failure_signature_get` MCP tool — Schema-driven implementation.
 *
 * @packageDocumentation
 */

import { Effect, Option, ParseResult, Schema } from "effect";
import { DataReader } from "vitest-agent-sdk";
import { publicProcedure } from "../context.js";

const RecentError = Schema.Struct({
	runId: Schema.Number,
	errorName: Schema.NullOr(Schema.String),
	message: Schema.String,
});

const SignatureFound = Schema.Struct({
	found: Schema.Literal(true).annotations({ description: "Discriminant — `true` when a signature row matched." }),
	signatureHash: Schema.String.annotations({
		title: "failure_signatures.signature_hash",
		description:
			"16-char SHA-256 over (error_name, normalized assertion shape, top-frame function name, function-boundary line).",
	}),
	firstSeenRunId: Schema.NullOr(Schema.Number),
	firstSeenAt: Schema.String,
	lastSeenAt: Schema.NullOr(Schema.String),
	occurrenceCount: Schema.Number.annotations({ description: "Total times this signature has been observed." }),
	recentErrors: Schema.Array(RecentError),
});

const SignatureMissing = Schema.Struct({
	found: Schema.Literal(false),
	requestedHash: Schema.String,
});

export const FailureSignatureGetResult = Schema.Union(SignatureFound, SignatureMissing).annotations({
	identifier: "FailureSignatureGetResult",
	title: "failure_signature_get result",
	description: "Discriminate on `found`. Found rows carry first/last-seen timestamps and recent occurrences.",
});
export type FailureSignatureGetResultType = Schema.Schema.Type<typeof FailureSignatureGetResult>;

export const formatFailureSignatureMarkdown = (data: FailureSignatureGetResultType): string => {
	if (!data.found) return `No failure signature found with hash=${data.requestedHash}.`;
	const lines: string[] = [
		`# Failure Signature \`${data.signatureHash}\``,
		"",
		`**Hash:** ${data.signatureHash}`,
		"",
		`- first_seen_at: ${data.firstSeenAt}`,
		`- last_seen_at: ${data.lastSeenAt ?? "unknown"}`,
		`- first_seen_run_id: ${data.firstSeenRunId ?? "unknown"}`,
		`- occurrence_count: ${data.occurrenceCount}`,
	];
	if (data.recentErrors.length > 0) {
		lines.push("", "## Recent Errors", "");
		for (const e of data.recentErrors) {
			lines.push(`- run=${e.runId} name=${e.errorName ?? "(none)"}: ${e.message.slice(0, 120)}`);
		}
	}
	return lines.join("\n");
};

export const FailureSignatureGetAsMarkdown = Schema.transformOrFail(FailureSignatureGetResult, Schema.String, {
	strict: true,
	decode: (data) => ParseResult.succeed(formatFailureSignatureMarkdown(data)),
	encode: (text, _options, ast) =>
		ParseResult.fail(new ParseResult.Forbidden(ast, text, "FailureSignatureGetAsMarkdown is one-way.")),
});

export const failureSignatureGet = publicProcedure
	.input(Schema.standardSchemaV1(Schema.Struct({ hash: Schema.String })))
	.query(
		async ({ ctx, input }): Promise<FailureSignatureGetResultType> =>
			ctx.runtime.runPromise(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					const opt = yield* reader.getFailureSignatureByHash(input.hash);
					if (Option.isNone(opt)) return { found: false as const, requestedHash: input.hash };
					return { found: true as const, ...opt.value };
				}),
			),
	);
