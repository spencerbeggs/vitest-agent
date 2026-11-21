// packages/mcp/src/prompts/why-flaky.ts
import type { PromptResult } from "./triage.js";

export interface WhyFlakyArgs {
	readonly test: string;
	readonly project?: string;
}

export function whyFlakyPrompt(args: WhyFlakyArgs): PromptResult {
	const projectClause = args.project ? ` in project \`${args.project}\`` : "";
	const text = [
		`Diagnose why the test \`${args.test}\` is flaky${projectClause}.`,
		"",
		"Steps:",
		"",
		`1. Call \`test_history\` for ${args.project ? `\`project: "${args.project}"\` and ` : ""}the named test to read the recent pass/fail pattern.`,
		"2. For any recent failure with a `signature_hash`, call `failure_signature_get` to see whether the same signature has appeared in earlier runs. A repeating signature is structural; a one-off signature is environmental.",
		"3. Look for these classic flake sources, in order:",
		"   - **Timing-based assertions** — `vi.useFakeTimers` not paired with `vi.useRealTimers`, or assertions that race with `setTimeout`/`setInterval`. Fake timers do not patch `node:timers` or `node:timers/promises` unless you opt in with `vi.useFakeTimers({ fakeNodeBuiltins: true })` (Vitest 5.1+), so code importing from those modules keeps using real timers.",
		"   - **Shared state across tests** — module-level mutables, `globalThis`, file system fixtures not cleaned up.",
		"   - **External I/O** — network calls without mocks, real database connections, real disk writes.",
		"   - **Non-deterministic input** — `Date.now()`, `Math.random()`, environment-dependent paths.",
		"",
		"Decide: is this a **true flake** (intermittent based on timing/state) or an **environmental failure** (consistent given specific environment conditions)? They have different fixes.",
		"",
		"If you reach a conclusion, record it via `hypothesis` (action `record`) with the test_error_id and stack_frame_id of the most recent failure as evidence.",
	].join("\n");
	return {
		messages: [{ role: "user", content: { type: "text", text } }],
	};
}
