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

const runFixture = (): void => {
	rmSync(join(FIXTURE_DIR, ".vitest"), { recursive: true, force: true });
	// `AI_AGENT` is std-env's explicit override, so the plugin resolves the
	// `agent` executor — the slot report files default on for. CI and
	// GITHUB_ACTIONS are cleared so they cannot win the detection instead.
	const { CI: _ci, GITHUB_ACTIONS: _gha, ...rest } = process.env;
	try {
		execFileSync("node", [VITEST_BIN, "run", "--no-color"], {
			cwd: FIXTURE_DIR,
			encoding: "utf8",
			env: { ...rest, AI_AGENT: "claude" },
			stdio: ["pipe", "pipe", "pipe"],
		});
	} catch {
		// A non-zero exit still leaves the report files behind.
	}
};

describe("report files written under .vitest/vitest-agent", () => {
	it("writes run.json parsing against RunReportFile", { timeout: 120_000 }, () => {
		runFixture();
		expect(existsSync(REPORT_DIR)).toBe(true);
		// A clean run has no classification, coverage, or trend section, so
		// `summary.md` is deliberately absent — the envelope is unconditional,
		// the markdown is not.
		expect(readdirSync(REPORT_DIR).sort()).toEqual(["run.json"]);
		const raw = readFileSync(join(REPORT_DIR, "run.json"), "utf8");
		const parsed = Schema.decodeUnknownSync(RunReportFile)(JSON.parse(raw));
		expect(parsed.$schema).toBe(RUN_REPORT_FILE_SCHEMA_URL);
		expect(parsed.schemaVersion).toBe(1);
		expect(parsed.reports.length).toBeGreaterThan(0);
		expect(parsed.reports[0]?.summary.passed).toBe(1);
	});
});
