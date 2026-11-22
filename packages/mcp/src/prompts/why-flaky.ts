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
		"2. For any recent failure with a `signature_hash`, call `failure_signature_get` to see whether the same signature has appeared in earlier runs. A repeating signature is structural; a one-off signature is environmental. `occurrenceCount` counts each finally-failed test once per run and skips sightings on tests that passed on a retry, so `occurrenceCount: 0` means the signature has only appeared on attempts that later passed: a flake. Do not compare it with the length of `recentErrors`: every retry attempt writes its own error row, and the list is capped at 10. Otherwise read flakiness from step 1's pass/fail history.",
		"   `test_history` also returns `retried[]`: for a test that ran more than one attempt (a retry or a repeat) in the latest run, every attempt's `state`, indexes and `errorIds`. A test that failed on one attempt and passed on a later one is a flake by definition; read which attempt failed and how from the matching `test_errors` row, whose `attempt` names the retry/repeat index that raised it.",
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
