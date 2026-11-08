/**
 * End-to-end test for `agent register-agent`.
 *
 * Spins up a hermetic `CliTest` sandbox (workspace + XDG data dir + CLAUDE_PLUGIN_DATA),
 * shells out to the built CLI bin, asserts the printed agentId is a
 * UUID, then re-runs and asserts the same agentId comes back
 * (idempotency hit).
 *
 * The CLI bin is invoked via `node dist/prod/npm/pkg/bin/vitest-agent.js`;
 * `vitest.setup.ts` builds it before the suite runs.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliSession } from "./utils/cli-test.js";
import { openSession } from "./utils/cli-test.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let session: CliSession;
let workspaceDir: string;
let pluginDataDir: string;

beforeEach(async () => {
	session = await openSession();
	workspaceDir = join(session.sandbox.root, "workspace");
	pluginDataDir = join(session.sandbox.root, "plugin-data");
	mkdirSync(workspaceDir);
	mkdirSync(pluginDataDir);
	writeFileSync(
		join(workspaceDir, "package.json"),
		JSON.stringify({ name: "register-agent-fixture", version: "0.0.0" }),
		"utf-8",
	);
});

afterEach(() => session.close());

interface RegisterAgentResult {
	readonly agentId: string;
	readonly conversationId: string;
	readonly mainAgentId: string;
	readonly idempotencyKey: string;
	readonly idempotencyHit: boolean;
}

const runRegister = async (args: { hostSessionId: string; transcriptPath: string }): Promise<RegisterAgentResult> => {
	const argv = [
		"agent",
		"register-agent",
		"--host-kind=claude-code",
		"--agent-type=claude-code-main",
		`--host-session-id=${args.hostSessionId}`,
		`--transcript-path=${args.transcriptPath}`,
		`--cwd=${workspaceDir}`,
	];
	// The sandbox owns XDG_DATA_HOME and nothing is inherited from the host.
	const { stdout } = await session.run(argv, { env: { CLAUDE_PLUGIN_DATA: pluginDataDir }, expectExit: 0 });
	return JSON.parse(stdout.trim()) as RegisterAgentResult;
};

describe("vitest-agent agent register-agent", () => {
	it("returns a UUID agentId on first invocation", async () => {
		const result = await runRegister({
			hostSessionId: "host-session-1",
			transcriptPath: "/tmp/transcript-uuid-1.jsonl",
		});
		expect(result.agentId).toMatch(UUID_REGEX);
		expect(result.conversationId).toMatch(UUID_REGEX);
		expect(result.mainAgentId).toMatch(UUID_REGEX);
		expect(result.idempotencyHit).toBe(false);
	});

	it("returns the same agentId on a second invocation with the same inputs (idempotency hit)", async () => {
		const a = await runRegister({
			hostSessionId: "host-session-2",
			transcriptPath: "/tmp/transcript-uuid-2.jsonl",
		});
		const b = await runRegister({
			hostSessionId: "host-session-2",
			transcriptPath: "/tmp/transcript-uuid-2.jsonl",
		});
		expect(a.agentId).toBe(b.agentId);
		expect(a.conversationId).toBe(b.conversationId);
		expect(b.idempotencyHit).toBe(true);
	});

	it("returns different agentIds for different host_session_ids", async () => {
		const a = await runRegister({
			hostSessionId: "host-session-3a",
			transcriptPath: "/tmp/transcript-uuid-3a.jsonl",
		});
		const b = await runRegister({
			hostSessionId: "host-session-3b",
			transcriptPath: "/tmp/transcript-uuid-3b.jsonl",
		});
		expect(a.agentId).not.toBe(b.agentId);
	});
});
