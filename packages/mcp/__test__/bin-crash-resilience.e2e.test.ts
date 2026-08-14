/**
 * Subprocess resilience regression for issue #191, sub-item A.
 *
 * `bin.ts` used to be a bare `main().catch((err) => { ...; process.exit(1); })`
 * with no process-level guards. Under Node >=15 an unhandled promise
 * rejection anywhere in the async chain crashes the process by
 * default, closing the stdio transport and silently deregistering
 * every tool from the client's perspective — mid TDD session, with no
 * recovery path. These tests spawn the *real built* MCP bin as a
 * subprocess (not `buildMcpServer` + `InMemoryTransport` — that runs
 * in the test's own process, which is exactly what must NOT crash
 * here) and drive it over a real `StdioClientTransport`, using an
 * env-var-gated test-only hook to inject each failure mode after the
 * transport connects.
 *
 * `.e2e.test.ts`: a real child process spawn is far outside plain
 * `.test.ts`'s 5s unit timeout — see `server-run-tests-schema.e2e.test.ts`
 * for the sibling convention.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const BIN = resolve(here, "..", "dist", "dev", "pkg", "bin", "vitest-agent-mcp.js");

const baseEnv: Record<string, string> = Object.fromEntries(
	Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

let xdgDir: string;
let client: Client | undefined;
let transport: StdioClientTransport | undefined;

afterEach(async () => {
	if (client) await client.close();
	client = undefined;
	transport = undefined;
	if (xdgDir) rmSync(xdgDir, { recursive: true, force: true });
});

async function spawnCrashInjectedClient(kind: "unhandledRejection" | "uncaughtException") {
	xdgDir = mkdtempSync(resolve(tmpdir(), "va-mcp-crash-resilience-"));
	transport = new StdioClientTransport({
		command: "node",
		args: [BIN],
		cwd: repoRoot,
		env: {
			...baseEnv,
			XDG_DATA_HOME: xdgDir,
			VITEST_AGENT_REPORTER_PROJECT_DIR: repoRoot,
			VITEST_AGENT_MCP_TEST_INJECT_CRASH: kind,
		},
		stderr: "pipe",
	});
	let stderrBuf = "";
	transport.stderr?.on("data", (chunk: Buffer) => {
		stderrBuf += chunk.toString();
	});
	client = new Client({ name: "bin-crash-resilience-test", version: "0.0.0" });
	await client.connect(transport);
	return { client, getStderr: () => stderrBuf };
}

describe("MCP bin subprocess crash resilience", () => {
	it("survives an injected unhandledRejection after the transport connects", { timeout: 60_000 }, async () => {
		const { client: c, getStderr } = await spawnCrashInjectedClient("unhandledRejection");
		// Give the injected setImmediate rejection a turn to fire and be
		// handled before we probe liveness.
		await new Promise((r) => setTimeout(r, 300));
		const result = await c.callTool({ name: "ping", arguments: {} });
		expect(result.isError).not.toBe(true);
		expect((result.structuredContent as { message?: string } | undefined)?.message).toBe("pong");
		expect(getStderr()).toContain("unhandledRejection");
	});

	it("survives an injected uncaughtException after the transport connects", { timeout: 60_000 }, async () => {
		const { client: c, getStderr } = await spawnCrashInjectedClient("uncaughtException");
		await new Promise((r) => setTimeout(r, 300));
		const result = await c.callTool({ name: "ping", arguments: {} });
		expect(result.isError).not.toBe(true);
		expect((result.structuredContent as { message?: string } | undefined)?.message).toBe("pong");
		expect(getStderr()).toContain("uncaughtException");
	});
});
