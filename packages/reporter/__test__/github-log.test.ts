/**
 * Unit tests for `renderGithubLog` — the collapsed-group stdout log block
 * emitted alongside the GitHub step summary when `kit.config.githubActions`
 * is true.
 */

import type { AgentReport, ReporterKit, ReporterRenderInput } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { renderGithubLog } from "../src/githubLog.js";

const makeKit = (overrides: Partial<ReporterKit["config"]> = {}): ReporterKit => ({
	config: {
		executor: "ci",
		consoleMode: "passthrough",
		mcp: false,
		consoleOutput: "full",
		omitPassingTests: false,
		coverageConsoleLimit: 3,
		includeBareZero: false,
		githubActions: true,
		githubSummary: true,
		coverageMode: "full",
		format: "markdown",
		detail: "standard",
		noColor: true,
		...overrides,
	},
	stdEnv: "ci-github",
	stdOsc8: (_url, label) => label,
});

const makeReport = (overrides: Partial<AgentReport> = {}): AgentReport => ({
	timestamp: "2026-05-14T00:00:00.000Z",
	project: "demo",
	reason: "passed",
	summary: { total: 1, passed: 1, failed: 0, skipped: 0, duration: 10 },
	failed: [],
	unhandledErrors: [],
	failedFiles: [],
	...overrides,
});

const makeInput = (overrides: Partial<ReporterRenderInput> = {}): ReporterRenderInput => ({
	reports: [makeReport()],
	classifications: new Map(),
	...overrides,
});

describe("renderGithubLog", () => {
	it("wraps the content in ::group::/::endgroup:: markers targeting stdout as text/plain", () => {
		const output = renderGithubLog(makeInput(), makeKit());
		expect(output.target).toBe("stdout");
		expect(output.contentType).toBe("text/plain");
		const lines = output.content.split("\n");
		expect(lines[0]).toBe("::group::vitest-agent");
		expect(lines.at(-1)).toBe("::endgroup::");
	});
});
