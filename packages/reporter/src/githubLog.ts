/**
 * Light end-of-run log block for GitHub Actions.
 *
 * @privateRemarks
 * Wraps a summary of the run in GitHub's collapsed-group log markers so it
 * is collapsed by default in the Actions log viewer and never competes
 * with Vitest's own console output. Pushed alongside `renderGithubSummary`
 * whenever `kit.config.githubActions` is true. All data is derived from
 * fields already on `ReporterRenderInput` / `ReporterKit` — no new
 * plumbing. No ANSI escapes: GitHub renders raw log text.
 *
 * @internal
 */

import { relative } from "node:path";
import type { RenderedOutput, ReporterKit, ReporterRenderInput, TestClassification } from "@vitest-agent/sdk";

const MAX_NAMED_FILES = 3;

/**
 * Renders a coverage-target file path relative to `process.cwd()` for
 * display. Falls back to the original string unchanged when the relative
 * path is empty or escapes the root (starts with `..`) rather than
 * printing a `../../..` chain.
 */
function toDisplayPath(file: string): string {
	const rel = relative(process.cwd(), file);
	if (rel === "" || rel.startsWith("..")) {
		return file;
	}
	return rel;
}

const NON_STABLE_CLASSIFICATIONS: ReadonlyArray<TestClassification> = [
	"new-failure",
	"persistent",
	"flaky",
	"recovered",
];

export function renderGithubLog(input: ReporterRenderInput, kit: ReporterKit): RenderedOutput {
	const lines: string[] = ["::group::vitest-agent"];

	for (const report of input.reports) {
		const name = report.project ?? "default";
		lines.push(
			`${name}: ${report.summary.passed}/${report.summary.total} passed, ${report.summary.failed} failed, ${report.summary.skipped} skipped`,
		);
	}

	const belowTarget = input.reports.flatMap((r) => r.coverage?.belowTarget ?? []);
	if (belowTarget.length > 0) {
		const names = belowTarget.slice(0, MAX_NAMED_FILES).map((f) => toDisplayPath(f.file));
		const suffix = belowTarget.length > MAX_NAMED_FILES ? `, +${belowTarget.length - MAX_NAMED_FILES} more` : "";
		lines.push(`coverage: ${belowTarget.length} file(s) below target (${names.join(", ")}${suffix})`);
	}

	const classificationCounts = new Map<TestClassification, number>();
	for (const classification of input.classifications.values()) {
		classificationCounts.set(classification, (classificationCounts.get(classification) ?? 0) + 1);
	}
	const classificationParts = NON_STABLE_CLASSIFICATIONS.filter(
		(kind) => (classificationCounts.get(kind) ?? 0) > 0,
	).map((kind) => `${kind}: ${classificationCounts.get(kind)}`);
	if (classificationParts.length > 0) {
		lines.push(`classifications: ${classificationParts.join(", ")}`);
	}

	if (kit.config.dbPath !== undefined) {
		lines.push(`db: ${kit.config.dbPath}`);
	}

	lines.push("::endgroup::");

	return { target: "stdout", content: lines.join("\n"), contentType: "text/plain" };
}
