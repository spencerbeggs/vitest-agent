import type { AgentReport, ConsoleMode } from "@vitest-agent/sdk";
import { stripAnsi } from "@vitest-agent/sdk";

/**
 * Maximum number of lines in the stderr failure summary, the `... N more`
 * line included. Matches the tail `vitest doctor` shows for a trial run.
 *
 * @internal
 */
export const FAILURE_SUMMARY_MAX_LINES = 15;

const firstLine = (message: string): string => {
	for (const line of stripAnsi(message).split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed.length > 0) return trimmed;
	}
	return "";
};

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Whether the plugin owns stdout in this console mode, so failure detail
 * never reaches stderr unless the reporter writes it there.
 *
 * @internal
 */
export function shouldWriteFailureSummary(mode: ConsoleMode): boolean {
	return mode === "agent" || mode === "stream" || mode === "ci-annotations";
}

/**
 * Format a plain-text, ANSI-free failure summary for stderr: a count header
 * plus one entry per failed test, failed module and unhandled error (each
 * reduced to its first message line), capped at
 * {@link FAILURE_SUMMARY_MAX_LINES} lines. Returns `undefined` when there is
 * nothing to report.
 *
 * @internal
 */
export function formatFailureSummary(
	reports: ReadonlyArray<AgentReport>,
	reason: "passed" | "failed" | "interrupted",
): string | undefined {
	const entries: string[][] = [];
	const files = new Set<string>();
	const seenUnhandled = new Set<string>();
	const unhandled: string[][] = [];
	let failedTests = 0;

	for (const report of reports) {
		for (const mod of report.failed) {
			files.add(mod.file);
			const moduleError = mod.errors?.[0];
			if (moduleError !== undefined) {
				const msg = firstLine(moduleError.message);
				entries.push([`  FAIL ${mod.file}`, ...(msg === "" ? [] : [`    ${msg}`])]);
			}
			for (const test of mod.tests) {
				if (test.state !== "failed") continue;
				failedTests++;
				const msg = firstLine(test.errors?.[0]?.message ?? "");
				entries.push([`  FAIL ${mod.file} > ${test.fullName}`, ...(msg === "" ? [] : [`    ${msg}`])]);
			}
		}
		// Unhandled errors ride every project's report; list each once.
		for (const err of report.unhandledErrors) {
			const msg = firstLine(err.message);
			if (seenUnhandled.has(msg)) continue;
			seenUnhandled.add(msg);
			unhandled.push([`  ERROR ${msg}`]);
		}
	}
	entries.push(...unhandled);

	if (entries.length === 0 && reason !== "interrupted") return undefined;

	const counts: string[] = [];
	if (failedTests > 0 || files.size > 0) {
		counts.push(`${plural(failedTests, "failed test")} in ${plural(files.size, "file")}`);
	}
	if (unhandled.length > 0) counts.push(plural(unhandled.length, "unhandled error"));
	const header =
		reason === "interrupted"
			? `vitest-agent: run interrupted${counts.length > 0 ? `, ${counts.join(", ")}` : ""}`
			: `vitest-agent: ${counts.join(", ")}`;

	const lines = [header];
	let budget = FAILURE_SUMMARY_MAX_LINES - 1;
	const total = entries.reduce((n, e) => n + e.length, 0);
	if (total > budget) budget -= 1; // reserve the "... N more" line
	let shown = 0;
	for (const entry of entries) {
		if (entry.length > budget) break;
		lines.push(...entry);
		budget -= entry.length;
		shown++;
	}
	if (shown < entries.length) lines.push(`  ... ${entries.length - shown} more`);
	return lines.join("\n");
}
