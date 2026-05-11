// packages/mcp/src/prompts/index.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { explainFailurePrompt } from "./explain-failure.js";
import { regressionSincePassPrompt } from "./regression-since-pass.js";
import { tddResumePrompt } from "./tdd-resume.js";
import { triagePrompt } from "./triage.js";
import { whyFlakyPrompt } from "./why-flaky.js";
import type { WrapupKind } from "./wrapup.js";
import { wrapupPrompt } from "./wrapup.js";

function toMessages(
	messages: ReadonlyArray<{
		readonly role: "user";
		readonly content: { readonly type: "text"; readonly text: string };
	}>,
) {
	return messages.map((m) => ({
		role: m.role as "user" | "assistant",
		content: { type: "text" as const, text: m.content.text },
	}));
}

export function registerAllPrompts(server: McpServer): void {
	server.registerPrompt(
		"triage",
		{
			title: "Triage Recent Failures",
			description:
				"Orient toward a triage workflow over the most recent test run; compose triage_brief, failure_signature_get, hypothesis_record.",
			argsSchema: {
				project: z.optional(z.string()).describe("Filter to a specific project"),
			},
		},
		(args) => {
			const result = triagePrompt(args.project !== undefined ? { project: args.project } : {});
			return { messages: toMessages(result.messages) };
		},
	);

	server.registerPrompt(
		"why-flaky",
		{
			title: "Diagnose a Flaky Test",
			description:
				"Diagnose why a named test is flaky; compose test_history and failure_signature_get with timing/shared-state framing.",
			argsSchema: {
				test: z.string().describe("Full hierarchical test name (e.g. 'Suite > nested > test')"),
				project: z.optional(z.string()).describe("Filter to a specific project"),
			},
		},
		(args) => {
			const result = whyFlakyPrompt(
				args.project !== undefined ? { test: args.test, project: args.project } : { test: args.test },
			);
			return { messages: toMessages(result.messages) };
		},
	);

	server.registerPrompt(
		"regression-since-pass",
		{
			title: "Find What Broke a Test",
			description:
				"Walk back from the test's most recent passing run to identify the change that broke it; compose test_history, commit_changes, turn_search.",
			argsSchema: {
				test: z.string().describe("Full hierarchical test name"),
				project: z.optional(z.string()).describe("Filter to a specific project"),
			},
		},
		(args) => {
			const result = regressionSincePassPrompt(
				args.project !== undefined ? { test: args.test, project: args.project } : { test: args.test },
			);
			return { messages: toMessages(result.messages) };
		},
	);

	server.registerPrompt(
		"explain-failure",
		{
			title: "Explain a Failure Class",
			description: "Synthesize a root-cause explanation from the recurrence history of a failure signature.",
			argsSchema: {
				signature: z.string().describe("16-char failure signature hex"),
			},
		},
		(args) => {
			const result = explainFailurePrompt({ signature: args.signature });
			return { messages: toMessages(result.messages) };
		},
	);

	server.registerPrompt(
		"tdd-resume",
		{
			title: "Resume TDD Work",
			description:
				"Resume the active TDD task from its current phase; iron-law reminder for evidence-bound transitions.",
			argsSchema: {
				sessionId: z
					.optional(z.string())
					.describe("Host session id (defaults to MCP server's recovered SessionContext)"),
			},
		},
		(args) => {
			const result = tddResumePrompt(args.sessionId !== undefined ? { sessionId: args.sessionId } : {});
			return { messages: toMessages(result.messages) };
		},
	);

	server.registerPrompt(
		"wrapup",
		{
			title: "Generate a Session Wrapup",
			description: "Surface the same wrapup content the post-hooks emit automatically.",
			argsSchema: {
				kind: z
					.optional(z.enum(["stop", "session_end", "pre_compact", "tdd_handoff", "user_prompt_nudge"]))
					.describe("Wrapup variant (default: user_prompt_nudge)"),
				since: z.optional(z.string()).describe("ISO 8601 timestamp lower bound for activity to summarize"),
			},
		},
		(args) => {
			const wrapupArgs: { kind?: WrapupKind; since?: string } = {};
			if (args.kind !== undefined) wrapupArgs.kind = args.kind as WrapupKind;
			if (args.since !== undefined) wrapupArgs.since = args.since;
			const result = wrapupPrompt(wrapupArgs);
			return { messages: toMessages(result.messages) };
		},
	);
}
