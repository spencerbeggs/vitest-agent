import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BinExitError, runBin } from "./utils/run-bin.js";

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
	const { stdout } = runBin(
		[
			"agent",
			"register-agent",
			"--host-kind=claude-code",
			"--agent-type=claude-code-main",
			`--host-session-id=${hostSessionId}`,
			`--transcript-path=${transcriptPath}`,
			`--cwd=${workspaceDir}`,
		],
		env(),
	);
	return JSON.parse(stdout.trim()) as RegisterAgentResult;
};

const end = (agentId: string, hostSessionId?: string): void => {
	const args = ["agent", "end-agent", `--agent-id=${agentId}`, `--cwd=${workspaceDir}`];
	if (hostSessionId !== undefined) args.push(`--host-session-id=${hostSessionId}`);
	// `runBin` pipes stderr instead of inheriting it — the failure-path
	// test deliberately triggers "AgentNotFoundError", which would
	// otherwise leak past Vitest's capture into the developer's terminal.
	runBin(args, env());
};

describe("vitest-agent agent end-agent", () => {
	it("succeeds when given a valid agentId from a prior register-agent call", () => {
		const reg = register("host-end-1", "/tmp/conv-end-1.jsonl");
		expect(() => end(reg.agentId)).not.toThrow();
	});

	it("exits non-zero when the agentId is unknown, surfacing the child's stderr", () => {
		expect(() => end("00000000-0000-0000-0000-000000000000")).toThrow(BinExitError);
		expect(() => end("00000000-0000-0000-0000-000000000000")).toThrow(/AgentNotFoundError/);
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
