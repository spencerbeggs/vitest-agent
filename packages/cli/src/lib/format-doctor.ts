/**
 * Formats doctor check results into markdown for CLI output.
 *
 * @packageDocumentation
 */

export interface CheckResult {
	name: string;
	passed: boolean;
	detail: string;
}

export function formatDoctor(results: CheckResult[]): string {
	const lines: string[] = [];
	lines.push("## Doctor\n");

	for (const result of results) {
		const icon = result.passed ? "[x]" : "[ ]";
		lines.push(`- ${icon} ${result.name}: ${result.detail}`);
	}

	const hasFailures = results.some((r) => !r.passed);
	if (hasFailures) {
		lines.push("\nSuggestion: Run `vitest-agent db reset` then re-run tests.");
	}

	return lines.join("\n");
}
