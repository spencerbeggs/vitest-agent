import { Effect, Option } from "effect";
import { DataReader } from "../services/DataReader.js";
/** @public */
export type WrapupKind = "stop" | "session_end" | "pre_compact" | "tdd_handoff" | "user_prompt_nudge";
/** @public */
export interface FormatWrapupOptions {
	readonly sessionId?: number;
	readonly chatId?: string;
	readonly kind: WrapupKind;
	readonly userPromptHint?: string;
}

// Anchored alternation with bounded character classes — no `.*` backtracking,
// linear-time match guaranteed even on adversarial inputs (the userPromptHint
// flows directly from the Claude Code envelope).
const FAILURE_PROMPT_PATTERN = /\b(?:test fail|fix\b[^.]*\btest|why\b[^.]*\bfail(?:ing)?|broken test)\b/i;
/** @public */
export const formatWrapupEffect = (options: FormatWrapupOptions): Effect.Effect<string, never, DataReader> =>
	Effect.gen(function* () {
		const reader = yield* DataReader;

		// user_prompt_nudge does not need the session; it inspects the prompt
		// text and emits a fixed nudge if the prompt looks failure-related.
		if (options.kind === "user_prompt_nudge") {
			const hint = options.userPromptHint ?? "";
			if (!FAILURE_PROMPT_PATTERN.test(hint)) return "";
			return [
				"<vitest-agent-nudge>",
				"Before fixing, consider checking with test_history (is this flaky?) and failure_signature_get (have we seen this failure before?).",
				"</vitest-agent-nudge>",
			].join("\n");
		}

		// Resolve sessionId AND agentKind from either the integer id or the
		// chat_id. Hypothesis-related nudges are gated on subagent sessions
		// (typically the TDD orchestrator); on main sessions the
		// `hypothesis({ action: "record" })` discipline is not in play, so
		// suggesting it is noise.
		let sessionId: number | null = null;
		let agentKind: "main" | "subagent" = "main";
		if (options.sessionId !== undefined) {
			sessionId = options.sessionId;
			const opt = yield* reader.getSessionById(options.sessionId).pipe(Effect.orElseSucceed(() => Option.none()));
			if (Option.isSome(opt)) agentKind = opt.value.agentKind;
		} else if (options.chatId !== undefined) {
			const opt = yield* reader.getSessionByChatId(options.chatId).pipe(Effect.orElseSucceed(() => Option.none()));
			if (Option.isSome(opt)) {
				sessionId = opt.value.id;
				agentKind = opt.value.agentKind;
			}
		}

		// TDD handoff: pull the subagent's tdd_task and summarize.
		if (options.kind === "tdd_handoff") {
			if (sessionId === null) return "";
			// Forward-compat probe — same magic id as format-triage. RC adds
			// a list-open-tdd-tasks reader in a later phase.
			const tddOpt = yield* reader.getTddTaskById(1).pipe(Effect.orElseSucceed(() => Option.none()));
			if (Option.isNone(tddOpt) || tddOpt.value.sessionId !== sessionId) {
				return "";
			}
			const tdd = tddOpt.value;
			return [
				`Subagent tdd-orchestrator (tddTaskId=${tdd.id}) finished.`,
				`Outcome: ${tdd.outcome ?? "in progress"}. Goal: "${tdd.goal}".`,
				`Phases: ${tdd.phases.length}. Artifacts: ${tdd.artifacts.length}.`,
				`[Read full summary: tdd_task({ action: "get", tddTaskId: ${tdd.id} })]`,
				`[Resume: /tdd resume:${tdd.id}]`,
			].join("\n");
		}

		if (sessionId === null) return "";

		// Pull the session's recent turns and hypotheses.
		const turns = yield* reader.searchTurns({ sessionId, limit: 50 }).pipe(Effect.orElseSucceed(() => []));
		const fileEditCount = turns.filter((t) => t.type === "file_edit").length;
		const hypotheses = yield* reader.listHypotheses({ sessionId, limit: 50 }).pipe(Effect.orElseSucceed(() => []));
		const openHypotheses = hypotheses.filter((h) => h.validationOutcome === null);

		if (fileEditCount === 0 && openHypotheses.length === 0) {
			return "";
		}

		const isSubagent = agentKind === "subagent";
		const lines: string[] = [];

		if (isSubagent) {
			if (fileEditCount > 0 && openHypotheses.length === 0) {
				lines.push(
					`- ${fileEditCount} recent file edit${fileEditCount === 1 ? "" : "s"} but no hypotheses recorded. Did your changes have a hypothesis? Use \`hypothesis({ action: "record" })\` to externalize the why before continuing.`,
				);
			}

			if (openHypotheses.length > 0) {
				lines.push(
					`- ${openHypotheses.length} open hypothesis(es). Use \`hypothesis({ action: "validate", id, outcome: "confirmed"|"refuted"|"abandoned", validatedAt })\` to mark them.`,
				);
			}
		}

		if (options.kind === "session_end") {
			lines.push('- Use `note({ action: "create" })` to record any insights worth carrying forward.');
		}

		if (options.kind === "pre_compact") {
			lines.push(
				'- What from this session matters next? Record it now via `note({ action: "create" })` before context compaction.',
			);
		}

		if (lines.length === 0) {
			return "";
		}

		const heading = options.kind === "stop" ? "## Before you finish" : "## Session wrap-up";
		return [heading, ...lines].join("\n");
	});
