import { Effect, Option, Schema } from "effect";
import { DataReader } from "vitest-agent-sdk";
import { publicProcedure } from "../context.js";

export const tddSessionGet = publicProcedure
	.input(Schema.standardSchemaV1(Schema.Struct({ id: Schema.Number })))
	.query(async ({ ctx, input }) => {
		return ctx.runtime.runPromise(
			Effect.gen(function* () {
				const reader = yield* DataReader;
				const opt = yield* reader.getTddSessionById(input.id);
				if (Option.isNone(opt)) return `No TDD session with id=${input.id}.`;
				const s = opt.value;
				const lines: string[] = [
					`# TDD Session ${s.id}`,
					"",
					`- goal: ${s.goal}`,
					`- run_id: ${s.runId ?? "(none — run_id not recorded)"}`,
					`- session_id: ${s.sessionId}`,
					`- started: ${s.startedAt}`,
					`- ended: ${s.endedAt ?? "still open"}`,
					`- outcome: ${s.outcome ?? "pending"}`,
				];
				if (s.phases.length > 0) {
					lines.push("", "## Phases", "");
					for (const p of s.phases) {
						const duration = p.endedAt ? ` -> ${p.endedAt}` : " (current)";
						lines.push(`- **${p.phase}** [id=${p.id}] ${p.startedAt}${duration}`);
						if (p.transitionReason) {
							lines.push(`  - reason: ${p.transitionReason}`);
						}
					}
				}
				if (s.artifacts.length > 0) {
					lines.push("", "## Artifacts", "");
					for (const a of s.artifacts) {
						lines.push(
							`- **${a.artifactKind}** [id=${a.id}, phase=${a.phaseId}] at=${a.recordedAt}${a.testRunId !== null ? ` run=${a.testRunId}` : ""}`,
						);
					}
				}
				if (s.goals.length > 0) {
					lines.push("", "## Goals and Behaviors", "");
					for (const g of s.goals) {
						lines.push(`### Goal ${g.ordinal + 1}: ${g.goal} [${g.status}]`);
						if (g.behaviors.length > 0) {
							lines.push("");
							for (const b of g.behaviors) {
								lines.push(`- **${b.behavior}** [${b.status}]`);
							}
						}
						lines.push("");
					}
				}
				return lines.join("\n");
			}),
		);
	});
