// `acceptance_metrics` MCP tool — Schema-driven implementation.
//
// Mirrors `DataReader.AcceptanceMetrics` as an Effect Schema so the
// structured payload the agent receives, the markdown rendering on
// the text channel, and the SDK-side `outputSchema` all derive from
// one canonical contract.

import { DataReader } from "@vitest-agent/engine";
import { Effect, Schema, SchemaGetter } from "effect";
import { Tool } from "effect/unstable/ai";
import { RenderText } from "../annotations.js";

const totalAnnotation = { description: "Sample size — number of observations the metric ratio is computed over." };
const ratioAnnotation = {
	description: "Compliance ratio in [0, 1]. Multiply by 100 for the percentage form rendered in the markdown view.",
};

/**
 * The `acceptance_metrics` tool's success payload.
 *
 * @public
 */
export const AcceptanceMetricsResult = Schema.Struct({
	phaseEvidenceIntegrity: Schema.Struct({
		total: Schema.Finite.annotate(totalAnnotation),
		compliant: Schema.Finite.annotate({
			description: "Phase transitions that cited a valid artifact and passed binding-rule validation.",
		}),
		ratio: Schema.Finite.annotate(ratioAnnotation),
	}).annotate({
		title: "Phase-evidence integrity",
		description:
			"Fraction of accepted TDD phase transitions whose cited artifact satisfied the D2 binding rules. Spec target ≥80%.",
	}),
	complianceHookResponsiveness: Schema.Struct({
		total: Schema.Finite.annotate(totalAnnotation),
		withFollowup: Schema.Finite.annotate({
			description: "PreToolUse denials / `additionalContext` reminders the orchestrator acknowledged in the next turn.",
		}),
		ratio: Schema.Finite.annotate(ratioAnnotation),
	}).annotate({
		title: "Compliance-hook responsiveness",
		description: "Fraction of compliance signals from PreToolUse hooks the orchestrator acted on. Spec target ≥40%.",
	}),
	orientationUsefulness: Schema.Struct({
		total: Schema.Finite.annotate(totalAnnotation),
		referencedCount: Schema.Finite.annotate({
			description: "Sessions where `triage_brief` / `wrapup_prompt` content was referenced in subsequent decisions.",
		}),
		ratio: Schema.Finite.annotate(ratioAnnotation),
	}).annotate({
		title: "Orientation usefulness",
		description:
			"Fraction of sessions where orientation prompts measurably steered orchestrator behaviour. Spec target ≥50%.",
	}),
	antiPatternDetectionRate: Schema.Struct({
		total: Schema.Finite.annotate(totalAnnotation),
		cleanSessions: Schema.Finite.annotate({
			description: "Sessions that produced no `tdd_artifacts(kind='test_weakened')` rows or DATABASE_BYPASS notes.",
		}),
		ratio: Schema.Finite.annotate(ratioAnnotation),
	}).annotate({
		title: "Anti-pattern detection rate",
		description: "Fraction of sessions free of weakening edits or sqlite3 bypass attempts. Spec target ≥95%.",
	}),
}).annotate({
	identifier: "AcceptanceMetricsResult",
	title: "Acceptance metrics",
	description:
		"The four spec Annex A metrics computed from the current database. Each carries a sample size, a count, and a ratio.",
});
/**
 * The decoded {@link AcceptanceMetricsResult}.
 *
 * @public
 */
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

export const AcceptanceMetricsAsMarkdown = AcceptanceMetricsResult.pipe(
	Schema.decodeTo(Schema.String, {
		decode: SchemaGetter.transform((data) => formatAcceptanceMetricsMarkdown(data)),
		encode: SchemaGetter.forbidden(
			() => "AcceptanceMetricsAsMarkdown is one-way: markdown cannot be parsed back to AcceptanceMetricsResult.",
		),
	}),
);

/**
 * Handler for {@link acceptanceMetricsTool}.
 *
 * @public
 */
export const handleAcceptanceMetrics = (): Effect.Effect<AcceptanceMetricsResultType, never, DataReader> =>
	Effect.gen(function* () {
		const reader = yield* DataReader;
		return yield* reader.computeAcceptanceMetrics();
	}).pipe(Effect.orDie);

/**
 * The Effect-native `acceptance_metrics` tool. No parameters (the default
 * `Tool.EmptyParams` serves as a strict empty object).
 *
 * @public
 */
export const acceptanceMetricsTool = Tool.make("acceptance_metrics", {
	description:
		"Use when you need the four spec Annex A acceptance metrics computed from the current database. Returns markdown in content[] and a typed JSON object in structuredContent (per-metric { total, ratio, ... }).",
	success: AcceptanceMetricsResult,
	dependencies: [DataReader],
})
	.annotate(Tool.Title, "Acceptance metrics")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)
	.annotate(Tool.Idempotent, true)
	.annotate(RenderText, (encoded) => formatAcceptanceMetricsMarkdown(encoded as AcceptanceMetricsResultType));
