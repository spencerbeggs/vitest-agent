import { Effect, Option, Schema } from "effect";
import { DataReader } from "vitest-agent-sdk";
import { publicProcedure } from "../context.js";

export const sessionGet = publicProcedure
	.input(Schema.standardSchemaV1(Schema.Struct({ id: Schema.Number })))
	.query(async ({ ctx, input }) => {
		return ctx.runtime.runPromise(
			Effect.gen(function* () {
				const reader = yield* DataReader;
				const opt = yield* reader.getSessionById(input.id);
				if (Option.isNone(opt)) return `No session with id=${input.id}.`;
				const s = opt.value;
				const lines: string[] = [
					`# Session ${s.id}`,
					"",
					`- cc_session_id: \`${s.cc_session_id}\``,
					`- project: ${s.project}`,
					`- agent_kind: ${s.agentKind}${s.agentType ? ` (${s.agentType})` : ""}`,
					`- started: ${s.startedAt}`,
					`- ended: ${s.endedAt ?? "still open"}`,
					`- triage_was_non_empty: ${s.triageWasNonEmpty}`,
				];
				if (s.parentSessionId !== null) {
					lines.push(`- parent_session_id: ${s.parentSessionId}`);
				}
				return lines.join("\n");
			}),
		);
	});
