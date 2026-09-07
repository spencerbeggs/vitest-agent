/**
 * End-to-end proof that the default reporter's `report`-targeted outputs
 * reach disk: a real `vitest run` in a fixture that loads `AgentPlugin`
 * must leave `run.json` (parsing against the public `RunReportFile`
 * envelope) and, when a section has content, `summary.md` under
 * `.vitest/vitest-agent/`.
 *
 * Runs in the fixture directory rather than a temp copy so
 * `@vitest-agent/plugin` resolves through the workspace's node_modules;
 * `.vitest/` is removed in `afterAll`.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RUN_REPORT_FILE_SCHEMA_URL, RunReportFile } from "@vitest-agent/sdk";
import { Schema } from "effect";
import { afterAll, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, "fixtures", "report-files-project");
const WORKSPACE_ROOT = join(HERE, "..", "..", "..");
const VITEST_BIN = join(WORKSPACE_ROOT, "node_modules/vitest/vitest.mjs");
const REPORT_DIR = join(FIXTURE_DIR, ".vitest", "vitest-agent");

afterAll(() => rmSync(join(FIXTURE_DIR, ".vitest"), { recursive: true, force: true }));

/**
 * Run the fixture with every executor-detection variable stripped, then
 * layer `extraEnv` back on. `AI_AGENT` is std-env's explicit override, so
 * setting it resolves the `agent` executor — the slot report files
 * default on for. Omitting it leaves `terminal` / `human`, the slot they
 * default off for.
 */
const runFixture = (extraEnv: Record<string, string>): void => {
	rmSync(join(FIXTURE_DIR, ".vitest"), { recursive: true, force: true });
	const {
		CI: _ci,
		GITHUB_ACTIONS: _gha,
		AI_AGENT: _aiAgent,
		CLAUDECODE: _claudecode,
		CLAUDE_CODE: _claudeCode,
		...rest
	} = process.env;
	try {
		execFileSync("node", [VITEST_BIN, "run", "--no-color"], {
			cwd: FIXTURE_DIR,
			encoding: "utf8",
			env: { ...rest, ...extraEnv },
			stdio: ["pipe", "pipe", "pipe"],
		});
	} catch {
		// A non-zero exit still leaves the report files behind.
	}
};

describe("report files written under .vitest/vitest-agent", () => {
	it("writes run.json parsing against RunReportFile", { timeout: 120_000 }, () => {
		runFixture({ AI_AGENT: "claude" });
		expect(existsSync(REPORT_DIR)).toBe(true);
		// Both files land on a green run: the envelope is the machine
		// contract and the markdown always carries the totals table. The
		// exact set is an intentional contract pin — a new report file must
		// be a deliberate change here, not an unnoticed addition.
		expect(readdirSync(REPORT_DIR).sort()).toEqual(["run.json", "summary.md"]);
		const raw = readFileSync(join(REPORT_DIR, "run.json"), "utf8");
		const parsed = Schema.decodeUnknownSync(RunReportFile)(JSON.parse(raw));
		expect(parsed.$schema).toBe(RUN_REPORT_FILE_SCHEMA_URL);
		expect(parsed.schemaVersion).toBe(1);
		expect(parsed.reports.length).toBeGreaterThan(0);
		expect(parsed.reports[0]?.summary.passed).toBe(1);
	});

	it("writes summary.md carrying the totals row for the fixture project", { timeout: 120_000 }, () => {
		runFixture({ AI_AGENT: "claude" });
		const summary = readFileSync(join(REPORT_DIR, "summary.md"), "utf8");
		expect(summary).toContain("## vitest-agent");
		expect(summary).toContain("### Totals");
		expect(summary).toContain("| Project | Passed | Failed | Skipped | Duration |");
		// The fixture has no `name` on its Vitest project, so the reporter
		// falls back to "default"; one passing test, nothing else.
		expect(summary).toMatch(/\| default \| 1 \| 0 \| 0 \| [\d.]+m?s \|/);
	});

	it("writes nothing at all for the human executor", { timeout: 120_000 }, () => {
		// Negative control: with no agent/CI marker the plugin resolves the
		// `human` executor, report files default off, and the lazy
		// `createReport` handle is never opened — so not even the directory
		// appears. Proves the two assertions above are caused by the
		// executor forcing rather than by an unconditional write.
		runFixture({});
		expect(existsSync(join(FIXTURE_DIR, ".vitest"))).toBe(false);
	});
});
