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

import { formatWrapupEffect } from "@vitest-agent/sdk";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

const rowIdOption = Flag.optional(Flag.integer("row-id"));
const chatIdOption = Flag.optional(Flag.string("chat-id"));
const kindOption = Flag.withDefault(
	Flag.choice("kind", ["stop", "session_end", "pre_compact", "tdd_handoff", "user_prompt_nudge"]),
	"session_end",
);
const userPromptHintOption = Flag.optional(Flag.string("user-prompt-hint"));
const formatOption = Flag.withDefault(Flag.choice("format", ["markdown", "json"]), "markdown");

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
