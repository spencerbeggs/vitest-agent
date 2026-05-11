/**
 * `acceptance_metrics` MCP tool — Schema-driven implementation.
 *
 * Mirrors `DataReader.AcceptanceMetrics` as an Effect Schema so the
 * structured payload the agent receives, the markdown rendering on
 * the text channel, and the SDK-side `outputSchema` all derive from
 * one canonical contract.
 *
 * @packageDocumentation
 */

import { Effect, ParseResult, Schema } from "effect";
import { DataReader } from "vitest-agent-sdk";
import { publicProcedure } from "../context.js";

const totalAnnotation = { description: "Sample size — number of observations the metric ratio is computed over." };
const ratioAnnotation = {
	description: "Compliance ratio in [0, 1]. Multiply by 100 for the percentage form rendered in the markdown view.",
};

export const AcceptanceMetricsResult = Schema.Struct({
	phaseEvidenceIntegrity: Schema.Struct({
		total: Schema.Number.annotations(totalAnnotation),
		compliant: Schema.Number.annotations({
			description: "Phase transitions that cited a valid artifact and passed binding-rule validation.",
		}),
		ratio: Schema.Number.annotations(ratioAnnotation),
	}).annotations({
		title: "Phase-evidence integrity",
		description:
			"Fraction of accepted TDD phase transitions whose cited artifact satisfied the D2 binding rules. Spec target ≥80%.",
	}),
	complianceHookResponsiveness: Schema.Struct({
		total: Schema.Number.annotations(totalAnnotation),
		withFollowup: Schema.Number.annotations({
			description: "PreToolUse denials / `additionalContext` reminders the orchestrator acknowledged in the next turn.",
		}),
		ratio: Schema.Number.annotations(ratioAnnotation),
	}).annotations({
		title: "Compliance-hook responsiveness",
		description: "Fraction of compliance signals from PreToolUse hooks the orchestrator acted on. Spec target ≥40%.",
	}),
	orientationUsefulness: Schema.Struct({
		total: Schema.Number.annotations(totalAnnotation),
		referencedCount: Schema.Number.annotations({
			description: "Sessions where `triage_brief` / `wrapup_prompt` content was referenced in subsequent decisions.",
		}),
		ratio: Schema.Number.annotations(ratioAnnotation),
	}).annotations({
		title: "Orientation usefulness",
		description:
			"Fraction of sessions where orientation prompts measurably steered orchestrator behaviour. Spec target ≥50%.",
	}),
	antiPatternDetectionRate: Schema.Struct({
		total: Schema.Number.annotations(totalAnnotation),
		cleanSessions: Schema.Number.annotations({
			description: "Sessions that produced no `tdd_artifacts(kind='test_weakened')` rows or DATABASE_BYPASS notes.",
		}),
		ratio: Schema.Number.annotations(ratioAnnotation),
	}).annotations({
		title: "Anti-pattern detection rate",
		description: "Fraction of sessions free of weakening edits or sqlite3 bypass attempts. Spec target ≥95%.",
	}),
}).annotations({
	identifier: "AcceptanceMetricsResult",
	title: "Acceptance metrics",
	description:
		"The four spec Annex A metrics computed from the current database. Each carries a sample size, a count, and a ratio.",
});
export type AcceptanceMetricsResultType = Schema.Schema.Type<typeof AcceptanceMetricsResult>;

const fmtBucket = (r: { readonly total: number; readonly ratio: number }) =>
	r.total === 0 ? "no data" : `${(r.ratio * 100).toFixed(1)}% (n=${r.total})`;

export const formatAcceptanceMetricsMarkdown = (m: AcceptanceMetricsResultType): string =>
	[
		"# Acceptance metrics",
		"",
		`1. Phase-evidence integrity: ${fmtBucket(m.phaseEvidenceIntegrity)} — target ≥80%`,
		`2. Compliance-hook responsiveness: ${fmtBucket(m.complianceHookResponsiveness)} — target ≥40%`,
		`3. Orientation usefulness: ${fmtBucket(m.orientationUsefulness)} — target ≥50%`,
		`4. Anti-pattern detection rate: ${fmtBucket(m.antiPatternDetectionRate)} — target ≥95%`,
	].join("\n");

export const AcceptanceMetricsAsMarkdown = Schema.transformOrFail(AcceptanceMetricsResult, Schema.String, {
	strict: true,
	decode: (data) => ParseResult.succeed(formatAcceptanceMetricsMarkdown(data)),
	encode: (text, _options, ast) =>
		ParseResult.fail(
			new ParseResult.Forbidden(
				ast,
				text,
				"AcceptanceMetricsAsMarkdown is one-way: markdown cannot be parsed back to AcceptanceMetricsResult.",
			),
		),
});

export const acceptanceMetrics = publicProcedure.input(Schema.standardSchemaV1(Schema.Struct({}))).query(
	async ({ ctx }): Promise<AcceptanceMetricsResultType> =>
		ctx.runtime.runPromise(
			Effect.gen(function* () {
				const reader = yield* DataReader;
				return yield* reader.computeAcceptanceMetrics();
			}),
		),
);
