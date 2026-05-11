// packages/mcp/src/prompts/tdd-resume.ts
import type { PromptResult } from "./triage.js";

export interface TddResumeArgs {
	readonly sessionId?: string;
}

export function tddResumePrompt(args: TddResumeArgs): PromptResult {
	const sessionClause = args.sessionId
		? ` for sessionId \`${args.sessionId}\``
		: " for the active session (inferred from MCP server's recovered SessionContext)";
	const text = [
		`Resume TDD work${sessionClause}.`,
		"",
		"Steps:",
		"",
		`1. Call \`tdd_task({ action: "resume", id: <tdd-task-id> })\` to get the most recent open TDD task, including the current phase and the behavior backlog.`,
		"2. The current phase determines what comes next:",
		"   - **`spike` or `red.triangulate`** — write the next failing test for the current behavior.",
		"   - **`red`** — run the test once to capture a `test_failed_run` artifact, then transition to `green`.",
		"   - **`green`** — write the minimal source change to make the test pass; capture a `test_passed_run`; transition to `refactor`.",
		"   - **`refactor`** — improve the implementation without changing behavior; the test must still pass.",
		"",
		"**Iron law**: every transition needs a cited artifact. You cannot write source code without a failing test on file. You cannot transition `red→green` without a `test_failed_run` artifact for the test you intend to make pass. You cannot transition `green→refactor` without a `test_passed_run`. The validator will deny transitions with missing or mis-bound evidence.",
		"",
		"When in doubt, run the failing test once and record the artifact via the post-tool hooks — don't try to record artifacts directly.",
	].join("\n");
	return {
		messages: [{ role: "user", content: { type: "text", text } }],
	};
}
