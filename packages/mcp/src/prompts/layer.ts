// The six framing prompts registered on the Effect-native `McpServer`.
//
// Each prompt is a thin wire adapter over a pure factory in this directory
// (`triagePrompt`, `whyFlakyPrompt`, ...): the factory owns the text and is
// unit-tested directly; this module owns the names, descriptions, argument
// schemas and the mapping to `McpSchema.PromptMessage`. Prompt arguments
// are strings on the wire (MCP `prompts/get` carries `Record<string,
// string>`), so every parameter is `Schema.String`-based; `optionalKey`
// marks the ones `prompts/list` advertises as not required.
//
// `tdd-resume` is the one prompt with a server-side default: when the
// client omits `sessionId`, the text names the chat id the server recovered
// for this process (`McpSession`), which is why {@link PromptsLayer}
// requires that service.

import { Effect, Layer, Schema } from "effect";
import { McpSchema, McpServer } from "effect/unstable/ai";
import type { McpSession as McpSessionService } from "../session.js";
import { McpSession } from "../session.js";
import { explainFailurePrompt } from "./explain-failure.js";
import { regressionSincePassPrompt } from "./regression-since-pass.js";
import { tddResumePrompt } from "./tdd-resume.js";
import type { PromptResult } from "./triage.js";
import { triagePrompt } from "./triage.js";
import { whyFlakyPrompt } from "./why-flaky.js";
import type { WrapupKind } from "./wrapup.js";
import { wrapupPrompt } from "./wrapup.js";

/**
 * The six prompt names `PromptsLayer` registers, in registration order.
 * Pinned against the `help` text by `__test__/help-drift.test.ts`.
 *
 * @internal
 */
export const PROMPT_NAMES = [
	"triage",
	"why-flaky",
	"regression-since-pass",
	"explain-failure",
	"tdd-resume",
	"wrapup",
] as const;

/** The `wrapup.kind` literal set, served as the argument's closed vocabulary. */
export const WRAPUP_KINDS = ["stop", "session_end", "pre_compact", "tdd_handoff", "user_prompt_nudge"] as const;

const toMessages = (result: PromptResult): Array<McpSchema.PromptMessage> =>
	result.messages.map((m) => ({ role: m.role, content: McpSchema.TextContent.make({ text: m.content.text }) }));

const projectArg = Schema.optionalKey(Schema.String.annotate({ description: "Filter to a specific project" }));

const Triage = McpServer.prompt({
	name: PROMPT_NAMES[0],
	description:
		"Orient toward a triage workflow over the most recent test run; compose triage_brief, failure_signature_get, hypothesis_record.",
	parameters: { project: projectArg },
	content: (args) =>
		Effect.succeed(toMessages(triagePrompt(args.project !== undefined ? { project: args.project } : {}))),
});

const WhyFlaky = McpServer.prompt({
	name: PROMPT_NAMES[1],
	description:
		"Diagnose why a named test is flaky; compose test_history and failure_signature_get with timing/shared-state framing.",
	parameters: {
		test: Schema.String.annotate({ description: "Full hierarchical test name (e.g. 'Suite > nested > test')" }),
		project: projectArg,
	},
	content: (args) =>
		Effect.succeed(
			toMessages(
				whyFlakyPrompt(args.project !== undefined ? { test: args.test, project: args.project } : { test: args.test }),
			),
		),
});

const RegressionSincePass = McpServer.prompt({
	name: PROMPT_NAMES[2],
	description:
		"Walk back from the test's most recent passing run to identify the change that broke it; compose test_history, commit_changes, turn_search.",
	parameters: {
		test: Schema.String.annotate({ description: "Full hierarchical test name" }),
		project: projectArg,
	},
	content: (args) =>
		Effect.succeed(
			toMessages(
				regressionSincePassPrompt(
					args.project !== undefined ? { test: args.test, project: args.project } : { test: args.test },
				),
			),
		),
});

const ExplainFailure = McpServer.prompt({
	name: PROMPT_NAMES[3],
	description: "Synthesize a root-cause explanation from the recurrence history of a failure signature.",
	parameters: {
		signature: Schema.String.annotate({ description: "16-char failure signature hex" }),
	},
	content: (args) => Effect.succeed(toMessages(explainFailurePrompt({ signature: args.signature }))),
});

const TddResume = McpServer.prompt({
	name: PROMPT_NAMES[4],
	description: "Resume the active TDD task from its current phase; iron-law reminder for evidence-bound transitions.",
	parameters: {
		sessionId: Schema.optionalKey(
			Schema.String.annotate({ description: "Host session id (defaults to MCP server's recovered SessionContext)" }),
		),
	},
	content: (args) =>
		Effect.gen(function* () {
			const session = yield* McpSession;
			const sessionId = args.sessionId ?? session.sessionContext.get()?.chatId ?? session.currentSessionId.get();
			return toMessages(tddResumePrompt(sessionId === null ? {} : { sessionId }));
		}),
});

const Wrapup = McpServer.prompt({
	name: PROMPT_NAMES[5],
	description: "Surface the same wrapup content the post-hooks emit automatically.",
	parameters: {
		kind: Schema.optionalKey(
			Schema.Literals(WRAPUP_KINDS).annotate({ description: "Wrapup variant (default: user_prompt_nudge)" }),
		),
		since: Schema.optionalKey(
			Schema.String.annotate({ description: "ISO 8601 timestamp lower bound for activity to summarize" }),
		),
	},
	content: (args) => {
		const wrapupArgs: { kind?: WrapupKind; since?: string } = {};
		if (args.kind !== undefined) wrapupArgs.kind = args.kind;
		if (args.since !== undefined) wrapupArgs.since = args.since;
		return Effect.succeed(toMessages(wrapupPrompt(wrapupArgs)));
	},
});

/**
 * Every framing prompt as one layer; merged into `ServerLayer` beside the
 * toolkit registration. Requires `McpSession` for `tdd-resume`'s default.
 *
 * @public
 */
export const PromptsLayer: Layer.Layer<never, never, McpSessionService> = Layer.mergeAll(
	Triage,
	WhyFlaky,
	RegressionSincePass,
	ExplainFailure,
	TddResume,
	Wrapup,
);
