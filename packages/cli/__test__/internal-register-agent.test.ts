/**
 * End-to-end test for `_internal register-agent`.
 *
 * Spins up a temp workspace + temp data dir + temp CLAUDE_PLUGIN_DATA,
 * shells out to the built CLI bin, asserts the printed agentId is a
 * UUID, then re-runs and asserts the same agentId comes back
 * (idempotency hit).
 *
 * The CLI bin is invoked via `node dist/dev/bin.js` after the package
 * is built; the test calls `pnpm --filter vitest-agent-cli run prepare`
 * via a setup helper if needed.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const BIN = resolve(__dirname, "..", "dist", "dev", "bin", "vitest-agent.js");

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let workspaceDir: string;
let xdgDataDir: string;
let pluginDataDir: string;

beforeEach(() => {
	workspaceDir = mkdtempSync(join(tmpdir(), "register-agent-ws-"));
	xdgDataDir = mkdtempSync(join(tmpdir(), "register-agent-xdg-"));
	pluginDataDir = mkdtempSync(join(tmpdir(), "register-agent-plugin-"));
	writeFileSync(
		join(workspaceDir, "package.json"),
		JSON.stringify({ name: "register-agent-fixture", version: "0.0.0" }),
		"utf-8",
	);
});

afterEach(() => {
	for (const dir of [workspaceDir, xdgDataDir, pluginDataDir]) {
		rmSync(dir, { recursive: true, force: true });
	}
});

interface RegisterAgentResult {
	readonly agentId: string;
	readonly conversationId: string;
	readonly mainAgentId: string;
	readonly idempotencyKey: string;
	readonly idempotencyHit: boolean;
}

const runRegister = (args: { hostSessionId: string; transcriptPath: string }): RegisterAgentResult => {
	const stdout = execFileSync(
		"node",
		[
			BIN,
			"_internal",
			"register-agent",
			"--host-kind=claude-code",
			"--agent-type=claude-code-main",
			`--host-session-id=${args.hostSessionId}`,
			`--transcript-path=${args.transcriptPath}`,
			`--cwd=${workspaceDir}`,
		],
		{
			env: {
				...process.env,
				XDG_DATA_HOME: xdgDataDir,
				CLAUDE_PLUGIN_DATA: pluginDataDir,
			},
		},
	);
	return JSON.parse(stdout.toString().trim()) as RegisterAgentResult;
};

describe("vitest-agent _internal register-agent", () => {
	it("returns a UUID agentId on first invocation", () => {
		const result = runRegister({
			hostSessionId: "host-session-1",
			transcriptPath: "/tmp/transcript-uuid-1.jsonl",
		});
		expect(result.agentId).toMatch(UUID_REGEX);
		expect(result.conversationId).toMatch(UUID_REGEX);
		expect(result.mainAgentId).toMatch(UUID_REGEX);
		expect(result.idempotencyHit).toBe(false);
	});

	it("returns the same agentId on a second invocation with the same inputs (idempotency hit)", () => {
		const a = runRegister({
			hostSessionId: "host-session-2",
			transcriptPath: "/tmp/transcript-uuid-2.jsonl",
		});
		const b = runRegister({
			hostSessionId: "host-session-2",
			transcriptPath: "/tmp/transcript-uuid-2.jsonl",
		});
		expect(a.agentId).toBe(b.agentId);
		expect(a.conversationId).toBe(b.conversationId);
		expect(b.idempotencyHit).toBe(true);
	});

	it("returns different agentIds for different host_session_ids", () => {
		const a = runRegister({
			hostSessionId: "host-session-3a",
			transcriptPath: "/tmp/transcript-uuid-3a.jsonl",
		});
		const b = runRegister({
			hostSessionId: "host-session-3b",
			transcriptPath: "/tmp/transcript-uuid-3b.jsonl",
		});
		expect(a.agentId).not.toBe(b.agentId);
	});
});
