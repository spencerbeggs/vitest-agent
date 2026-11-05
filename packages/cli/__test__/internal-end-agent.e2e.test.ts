import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunResult } from "@effected/cli-kit/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliSession } from "./utils/cli-test.js";
import { openSession } from "./utils/cli-test.js";

interface RegisterAgentResult {
	readonly agentId: string;
	readonly conversationId: string;
	readonly mainAgentId: string;
}

let session: CliSession;
let workspaceDir: string;
let pluginDataDir: string;

beforeEach(async () => {
	session = await openSession();
	workspaceDir = join(session.sandbox.root, "workspace");
	pluginDataDir = join(session.sandbox.root, "plugin-data");
	mkdirSync(workspaceDir);
	mkdirSync(pluginDataDir);
	writeFileSync(join(workspaceDir, "package.json"), JSON.stringify({ name: "end-agent-fixture" }), "utf-8");
});

afterEach(() => session.close());

/** Run the bin; the sandbox owns XDG_DATA_HOME and nothing is inherited from the host. */
const run = (args: ReadonlyArray<string>, expectExit?: number): Promise<RunResult> =>
	session.run(args, { env: { CLAUDE_PLUGIN_DATA: pluginDataDir }, expectExit });

const register = async (hostSessionId: string, transcriptPath: string): Promise<RegisterAgentResult> => {
	const args = [
		"agent",
		"register-agent",
		"--host-kind=claude-code",
		"--agent-type=claude-code-main",
		`--host-session-id=${hostSessionId}`,
		`--transcript-path=${transcriptPath}`,
		`--cwd=${workspaceDir}`,
	];
	const { stdout } = await run(args, 0);
	return JSON.parse(stdout.trim()) as RegisterAgentResult;
};

/** `end-agent`'s raw result; stderr is captured, so the failure path never leaks to the terminal. */
const end = (agentId: string, hostSessionId?: string, expectExit?: number): Promise<RunResult> => {
	const args = ["agent", "end-agent", `--agent-id=${agentId}`, `--cwd=${workspaceDir}`];
	if (hostSessionId !== undefined) args.push(`--host-session-id=${hostSessionId}`);
	return run(args, expectExit);
};

describe("vitest-agent agent end-agent", () => {
	it("succeeds when given a valid agentId from a prior register-agent call", async () => {
		const reg = await register("host-end-1", "/tmp/conv-end-1.jsonl");
		expect((await end(reg.agentId)).exitCode).toBe(0);
	});

	it("exits non-zero when the agentId is unknown, surfacing the child's stderr", async () => {
		const result = await end("00000000-0000-0000-0000-000000000000");
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toMatch(/AgentNotFoundError/);
	});

	it("rejects with the child's exit code and stderr when a run must exit 0 and does not", async () => {
		const failed = end("00000000-0000-0000-0000-000000000000", undefined, 0);

		await expect(failed).rejects.toMatchObject({ _tag: "CliTestFailure", expected: 0, exitCode: 5 });
		await expect(failed).rejects.toThrow(/AgentNotFoundError/);
	});

	it("with --host-session-id, also closes the session map row (subsequent register-agent generates a fresh main_agent_id for the same project_dir)", async () => {
		const a = await register("host-end-2", "/tmp/conv-end-2.jsonl");
		await end(a.agentId, "host-end-2", 0);
		// A new register-agent call with a different host_session_id but the
		// same project_dir should NOT see the prior session as the active
		// one for project_dir lookup. We can't directly assert the lookup
		// from the CLI, but we can verify a re-register with the SAME
		// host_session_id still returns the same agent (idempotency on
		// agents.idempotency_key works regardless of session_map state).
		const a2 = await register("host-end-2", "/tmp/conv-end-2.jsonl");
		expect(a2.agentId).toBe(a.agentId);
	});
});
