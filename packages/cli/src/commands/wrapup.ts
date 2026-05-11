/**
 * CLI wrapup command -- emits the W5 wrap-up prompt for a session.
 *
 * Drives the four interpretive hooks (Stop / SessionEnd / PreCompact /
 * UserPromptSubmit). Hooks invoke the bin with --kind set; humans on
 * the terminal can also run it on demand with --chat-id (host chat UUID)
 * or --row-id (internal integer FK, mostly for debugging).
 *
 * @packageDocumentation
 */

import { Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { formatWrapupEffect } from "vitest-agent-sdk";

const rowIdOption = Options.optional(Options.integer("row-id"));
const chatIdOption = Options.optional(Options.text("chat-id"));
const kindOption = Options.withDefault(
	Options.choice("kind", ["stop", "session_end", "pre_compact", "tdd_handoff", "user_prompt_nudge"]),
	"session_end",
);
const userPromptHintOption = Options.optional(Options.text("user-prompt-hint"));
const formatOption = Options.withDefault(Options.choice("format", ["markdown", "json"]), "markdown");

export const wrapupCommand = Command.make(
	"wrapup",
	{
		rowId: rowIdOption,
		chatId: chatIdOption,
		kind: kindOption,
		userPromptHint: userPromptHintOption,
		format: formatOption,
	},
	(opts) =>
		Effect.gen(function* () {
			const md = yield* formatWrapupEffect({
				...(opts.rowId._tag === "Some" && { sessionId: opts.rowId.value }),
				...(opts.chatId._tag === "Some" && { chatId: opts.chatId.value }),
				kind: opts.kind as "stop" | "session_end" | "pre_compact" | "tdd_handoff" | "user_prompt_nudge",
				...(opts.userPromptHint._tag === "Some" && { userPromptHint: opts.userPromptHint.value }),
			});

			if (opts.format === "json") {
				yield* Effect.sync(() => process.stdout.write(`${JSON.stringify({ wrapup: md })}\n`));
				return;
			}

			yield* Effect.sync(() => process.stdout.write(md.length > 0 ? `${md}\n` : ""));
		}),
).pipe(Command.withDescription("Emit the W5 wrap-up prompt for a session"));
