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
 * Built as an `@effected/cli` `Doc` (a top-level collapsible is a
 * `::group::`) and rendered with `Render.githubLog`, which also neutralizes
 * any workflow command a project name or path could otherwise inject.
 *
 * Known inconsistency, kept deliberately for now: the per-project line counts
 * a timed-out test as `failed` (it reads `report.summary.failed`), while the
 * step-summary totals table splits timeouts into their own column.
 *
 * @internal
 */

import { relative } from "node:path";
import type { Block } from "@effected/cli";
import { Doc, Render, Status } from "@effected/cli";
import type {
	AgentReport,
	RenderedOutput,
	ReporterKit,
	ReporterRenderInput,
	TestClassification,
} from "@vitest-agent/sdk";

const MAX_NAMED_FILES = 3;

/**
 * Renders a coverage-target file path relative to `process.cwd()` for
 * display. Falls back to the original string unchanged when the relative
 * path is empty or escapes the root (starts with `..`) rather than
 * printing a `../../..` chain.
 */
export function toDisplayPath(file: string): string {
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

/** `<project>: <passed>/<total> passed, <failed> failed, <skipped> skipped` — every counter shown, zeros included. */
const projectCounts = (report: AgentReport): Block => {
	const { passed, failed, skipped, total } = report.summary;
	return Doc.counts({
		label: report.project ?? "default",
		layout: "inline",
		total: () => total,
		counters: [
			Doc.counter(Status.core, "success", { key: "passed", label: "passed", n: passed, showZero: true }),
			Doc.counter(Status.core, "failure", { key: "failed", label: "failed", n: failed, showZero: true }),
			Doc.counter(Status.core, "skip", { key: "skipped", label: "skipped", n: skipped, showZero: true }),
		],
	});
};

export function renderGithubLog(input: ReporterRenderInput, kit: ReporterKit): RenderedOutput {
	const body: Block[] = input.reports.map(projectCounts);

	const belowTarget = input.reports.flatMap((r) => r.coverage?.belowTarget ?? []);
	if (belowTarget.length > 0) {
		const names = belowTarget.slice(0, MAX_NAMED_FILES).map((f) => toDisplayPath(f.file));
		const suffix = belowTarget.length > MAX_NAMED_FILES ? `, +${belowTarget.length - MAX_NAMED_FILES} more` : "";
		body.push(Doc.paragraph(`coverage: ${belowTarget.length} file(s) below target (${names.join(", ")}${suffix})`));
	}

	const classificationCounts = new Map<TestClassification, number>();
	for (const classification of input.classifications.values()) {
		classificationCounts.set(classification, (classificationCounts.get(classification) ?? 0) + 1);
	}
	const classificationParts = NON_STABLE_CLASSIFICATIONS.filter(
		(kind) => (classificationCounts.get(kind) ?? 0) > 0,
	).map((kind) => `${kind}: ${classificationCounts.get(kind)}`);
	if (classificationParts.length > 0) {
		body.push(Doc.paragraph(`classifications: ${classificationParts.join(", ")}`));
	}

	if (kit.config.dbPath !== undefined) {
		body.push(Doc.paragraph(`db: ${kit.config.dbPath}`));
	}

	// A `ci` context neutralizes workflow commands by default; `Render.githubLog`
	// neutralizes regardless, since its output is for the Actions runner.
	const ctx = Render.contextOf({ audience: "ci", displayPath: toDisplayPath });
	const content = Render.githubLog([Doc.collapsible("vitest-agent", body)], ctx);
	return { target: "stdout", content, contentType: "text/plain" };
}
