// `failure_signature_get` MCP tool — Schema-driven implementation.

import { DataReader } from "@vitest-agent/engine";
import { Effect, Option, Schema, SchemaGetter } from "effect";
import { Tool } from "effect/unstable/ai";
import { RenderText } from "../annotations.js";

const RecentError = Schema.Struct({
	runId: Schema.Number,
	errorName: Schema.NullOr(Schema.String),
	message: Schema.String,
});

const SignatureFound = Schema.Struct({
	found: Schema.Literal(true).annotate({ description: "Discriminant — `true` when a signature row matched." }),
	signatureHash: Schema.String.annotate({
		title: "failure_signatures.signature_hash",
		description:
			"16-char SHA-256 over (error_name, normalized assertion shape, top-frame function name, function-boundary line).",
	}),
	firstSeenRunId: Schema.NullOr(Schema.Number),
	firstSeenAt: Schema.String,
	lastSeenAt: Schema.NullOr(Schema.String),
	occurrenceCount: Schema.Finite.annotate({ description: "Total times this signature has been observed." }),
	recentErrors: Schema.Array(RecentError),
});

const SignatureMissing = Schema.Struct({
	found: Schema.Literal(false),
	requestedHash: Schema.String,
});

/**
 * The `failure_signature_get` tool's success payload.
 *
 * @public
 */
export const FailureSignatureGetResult = Schema.Union([SignatureFound, SignatureMissing]).annotate({
	identifier: "FailureSignatureGetResult",
	title: "failure_signature_get result",
	description: "Discriminate on `found`. Found rows carry first/last-seen timestamps and recent occurrences.",
});
/**
 * The decoded {@link FailureSignatureGetResult}.
 *
 * @public
 */
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

export const FailureSignatureGetAsMarkdown = FailureSignatureGetResult.pipe(
	Schema.decodeTo(Schema.String, {
		decode: SchemaGetter.transform((data) => formatFailureSignatureMarkdown(data)),
		encode: SchemaGetter.forbidden(() => "FailureSignatureGetAsMarkdown is one-way."),
	}),
);

/**
 * The `failure_signature_get` tool's parameters.
 *
 * @public
 */
export const FailureSignatureGetInput = Schema.Struct({
	hash: Schema.String.annotate({ description: "16-char failure signature hash" }),
});
/**
 * The decoded {@link FailureSignatureGetInput}.
 *
 * @public
 */
export type FailureSignatureGetInputType = Schema.Schema.Type<typeof FailureSignatureGetInput>;

/**
 * Handler for {@link failureSignatureGetTool}.
 *
 * @public
 */
export const handleFailureSignatureGet = (
	input: FailureSignatureGetInputType,
): Effect.Effect<FailureSignatureGetResultType, never, DataReader> =>
	Effect.gen(function* () {
		const reader = yield* DataReader;
		const opt = yield* reader.getFailureSignatureByHash(input.hash);
		if (Option.isNone(opt)) return { found: false as const, requestedHash: input.hash };
		return { found: true as const, ...opt.value };
	}).pipe(Effect.orDie);

/**
 * The Effect-native `failure_signature_get` tool.
 *
 * @public
 */
export const failureSignatureGetTool = Tool.make("failure_signature_get", {
	description:
		"Use when you have a failure-signature hash and need its first-seen date and occurrence history. Returns markdown in content[] and a typed JSON object in structuredContent ({ found, signatureHash?, firstSeenAt?, occurrenceCount?, recentErrors?[] } or absent variant).",
	parameters: FailureSignatureGetInput,
	success: FailureSignatureGetResult,
	dependencies: [DataReader],
})
	.annotate(Tool.Title, "Failure signature")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)
	.annotate(Tool.Idempotent, true)
	.annotate(RenderText, (encoded) => formatFailureSignatureMarkdown(encoded as FailureSignatureGetResultType));
