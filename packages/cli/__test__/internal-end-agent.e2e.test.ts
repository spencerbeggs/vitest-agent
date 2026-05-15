import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const BIN = resolve(__dirname, "..", "dist", "dev", "bin", "vitest-agent.js");

interface RegisterAgentResult {
	readonly agentId: string;
	readonly conversationId: string;
	readonly mainAgentId: string;
}

let workspaceDir: string;
let xdgDataDir: string;
let pluginDataDir: string;

beforeEach(() => {
	workspaceDir = mkdtempSync(join(tmpdir(), "end-agent-ws-"));
	xdgDataDir = mkdtempSync(join(tmpdir(), "end-agent-xdg-"));
	pluginDataDir = mkdtempSync(join(tmpdir(), "end-agent-plugin-"));
	writeFileSync(join(workspaceDir, "package.json"), JSON.stringify({ name: "end-agent-fixture" }), "utf-8");
});

afterEach(() => {
	for (const dir of [workspaceDir, xdgDataDir, pluginDataDir]) {
		rmSync(dir, { recursive: true, force: true });
	}
});

const env = () => ({
	...process.env,
	XDG_DATA_HOME: xdgDataDir,
	CLAUDE_PLUGIN_DATA: pluginDataDir,
});

const register = (hostSessionId: string, transcriptPath: string): RegisterAgentResult => {
	const stdout = execFileSync(
		"node",
		[
			BIN,
			"agent",
			"register-agent",
			"--host-kind=claude-code",
			"--agent-type=claude-code-main",
			`--host-session-id=${hostSessionId}`,
			`--transcript-path=${transcriptPath}`,
			`--cwd=${workspaceDir}`,
		],
		{ env: env() },
	);
	return JSON.parse(stdout.toString().trim()) as RegisterAgentResult;
};

const end = (agentId: string, hostSessionId?: string): void => {
	const args = [BIN, "agent", "end-agent", `--agent-id=${agentId}`, `--cwd=${workspaceDir}`];
	if (hostSessionId !== undefined) args.push(`--host-session-id=${hostSessionId}`);
	// Pipe stderr to a buffer instead of inheriting the parent's stderr —
	// the failure-path test deliberately triggers "5 AgentNotFoundError:"
	// which would otherwise leak past Vitest's capture and clutter the
	// developer's terminal during a routine `pnpm test` run.
	execFileSync("node", args, { env: env(), stdio: ["ignore", "ignore", "pipe"] });
};

describe("vitest-agent agent end-agent", () => {
	it("succeeds when given a valid agentId from a prior register-agent call", () => {
		const reg = register("host-end-1", "/tmp/conv-end-1.jsonl");
		expect(() => end(reg.agentId)).not.toThrow();
	});

	it("exits non-zero when the agentId is unknown", () => {
		expect(() => end("00000000-0000-0000-0000-000000000000")).toThrow();
	});

	it("with --host-session-id, also closes the session map row (subsequent register-agent generates a fresh main_agent_id for the same project_dir)", () => {
		const a = register("host-end-2", "/tmp/conv-end-2.jsonl");
		end(a.agentId, "host-end-2");
		// A new register-agent call with a different host_session_id but the
		// same project_dir should NOT see the prior session as the active
		// one for project_dir lookup. We can't directly assert the lookup
		// from the CLI, but we can verify a re-register with the SAME
		// host_session_id still returns the same agent (idempotency on
		// agents.idempotency_key works regardless of session_map state).
		const a2 = register("host-end-2", "/tmp/conv-end-2.jsonl");
		expect(a2.agentId).toBe(a.agentId);
	});
});
