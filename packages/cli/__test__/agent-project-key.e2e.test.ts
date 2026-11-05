/**
 * End-to-end test for issue #561: `agent register-agent --project-key X` and
 * `agent end-agent --project-key X` must write to X's data.db, not the
 * cwd-derived one the root platform opens.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliSession } from "./utils/cli-test.js";
import { openSession } from "./utils/cli-test.js";

const PROJECT_KEY = "probe-key";
const HOST_SESSION_ID = "11111111-1111-4111-8111-111111111111";

let session: CliSession;
let workspaceDir: string;
let xdgDataDir: string;
let pluginDataDir: string;

beforeEach(async () => {
	session = await openSession();
	workspaceDir = join(session.sandbox.root, "workspace");
	pluginDataDir = join(session.sandbox.root, "plugin-data");
	xdgDataDir = session.sandbox.env.XDG_DATA_HOME ?? "";
	mkdirSync(workspaceDir, { recursive: true });
	mkdirSync(pluginDataDir, { recursive: true });
	writeFileSync(join(workspaceDir, "package.json"), JSON.stringify({ name: "project-key-fixture" }), "utf-8");
});

afterEach(() => session.close());

/** Run the bin; the sandbox owns XDG_DATA_HOME and nothing is inherited from the host. */
const runOk = (args: ReadonlyArray<string>) =>
	session.run(args, { env: { CLAUDE_PLUGIN_DATA: pluginDataDir }, expectExit: 0 });

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
	it("should write the agents row into the --project-key data.db and end it there", async () => {
		const { stdout } = await runOk([
			"agent",
			"register-agent",
			"--host-kind=claude-code",
			"--agent-type=main",
			`--host-session-id=${HOST_SESSION_ID}`,
			"--transcript-path=/tmp/project-key.jsonl",
			`--cwd=${workspaceDir}`,
			`--project-key=${PROJECT_KEY}`,
		]);
		const { agentId } = JSON.parse(stdout.trim()) as { agentId: string };

		const registered = agentRows();
		expect(registered).toHaveLength(1);
		expect(registered[0]?.agent_id).toBe(agentId);

		await runOk([
			"agent",
			"end-agent",
			`--agent-id=${agentId}`,
			`--cwd=${workspaceDir}`,
			`--project-key=${PROJECT_KEY}`,
		]);

		const ended = agentRows();
		expect(ended).toHaveLength(1);
		expect(ended[0]?.ended_at).not.toBeNull();
	});
});
