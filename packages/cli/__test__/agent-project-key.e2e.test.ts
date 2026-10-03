/**
 * End-to-end test for issue #561: `agent register-agent --project-key X` and
 * `agent end-agent --project-key X` must write to X's data.db, not the
 * cwd-derived one the root platform opens.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBin } from "./utils/run-bin.js";

const PROJECT_KEY = "probe-key";
const HOST_SESSION_ID = "11111111-1111-4111-8111-111111111111";

let workspaceDir: string;
let xdgDataDir: string;
let pluginDataDir: string;

beforeEach(() => {
	workspaceDir = mkdtempSync(join(tmpdir(), "project-key-ws-"));
	xdgDataDir = mkdtempSync(join(tmpdir(), "project-key-xdg-"));
	pluginDataDir = mkdtempSync(join(tmpdir(), "project-key-plugin-"));
	mkdirSync(workspaceDir, { recursive: true });
	writeFileSync(join(workspaceDir, "package.json"), JSON.stringify({ name: "project-key-fixture" }), "utf-8");
});

afterEach(() => {
	for (const dir of [workspaceDir, xdgDataDir, pluginDataDir]) {
		rmSync(dir, { recursive: true, force: true });
	}
});

const env = (): NodeJS.ProcessEnv => {
	const base: NodeJS.ProcessEnv = { ...process.env, XDG_DATA_HOME: xdgDataDir, CLAUDE_PLUGIN_DATA: pluginDataDir };
	delete base.VITEST_AGENT_PROJECT_DIR;
	delete base.CLAUDE_PROJECT_DIR;
	delete base.VITEST_AGENT_REPORTER_PROJECT_DIR;
	return base;
};

const agentRows = (): Array<{ agent_id: string; ended_at: number | null }> => {
	const db = new DatabaseSync(join(xdgDataDir, "vitest-agent", PROJECT_KEY, "data.db"), { readOnly: true });
	try {
		return db.prepare("SELECT agent_id, ended_at FROM agents").all() as Array<{
			agent_id: string;
			ended_at: number | null;
		}>;
	} finally {
		db.close();
	}
};

describe("agent register-agent / end-agent --project-key", () => {
	it("should write the agents row into the --project-key data.db and end it there", () => {
		const { stdout } = runBin(
			[
				"agent",
				"register-agent",
				"--host-kind=claude-code",
				"--agent-type=main",
				`--host-session-id=${HOST_SESSION_ID}`,
				"--transcript-path=/tmp/project-key.jsonl",
				`--cwd=${workspaceDir}`,
				`--project-key=${PROJECT_KEY}`,
			],
			env(),
		);
		const { agentId } = JSON.parse(stdout.trim()) as { agentId: string };

		const registered = agentRows();
		expect(registered).toHaveLength(1);
		expect(registered[0]?.agent_id).toBe(agentId);

		runBin(
			["agent", "end-agent", `--agent-id=${agentId}`, `--cwd=${workspaceDir}`, `--project-key=${PROJECT_KEY}`],
			env(),
		);

		const ended = agentRows();
		expect(ended).toHaveLength(1);
		expect(ended[0]?.ended_at).not.toBeNull();
	});
});
