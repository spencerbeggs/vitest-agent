import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { injectEnv } from "../src/internal-inject-env.js";

let cwd: string;

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "inject-env-"));
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

const writePackageJson = (scripts: Record<string, string>) => {
	writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts }), "utf-8");
};

describe("injectEnv", () => {
	const env = { VITEST_AGENT_CONVERSATION_ID: "c1", VITEST_AGENT_AGENT_ID: "a1" };

	it("returns the original command when no agent env is set", () => {
		writePackageJson({ test: "vitest run" });
		const out = injectEnv({ command: "pnpm test", cwd, env: {} });
		expect(out).toBe("pnpm test");
	});

	it("returns the original command when only conversation_id is set", () => {
		const out = injectEnv({
			command: "vitest run",
			cwd,
			env: { VITEST_AGENT_CONVERSATION_ID: "c1" },
		});
		expect(out).toBe("vitest run");
	});

	it("rewrites a direct vitest invocation", () => {
		const out = injectEnv({ command: "vitest run", cwd, env });
		expect(out).toBe("VITEST_AGENT_CONVERSATION_ID=c1 VITEST_AGENT_AGENT_ID=a1 vitest run");
	});

	it("rewrites a pnpm test invocation when scripts.test mentions vitest", () => {
		writePackageJson({ test: "vitest run" });
		const out = injectEnv({ command: "pnpm test", cwd, env });
		expect(out).toBe("VITEST_AGENT_CONVERSATION_ID=c1 VITEST_AGENT_AGENT_ID=a1 pnpm test");
	});

	it("does NOT rewrite pnpm build when scripts.build does not mention vitest", () => {
		writePackageJson({ build: "tsc", test: "vitest" });
		const out = injectEnv({ command: "pnpm build", cwd, env });
		expect(out).toBe("pnpm build");
	});

	it("appends PARENT_AGENT_ID when set in env (subagent case)", () => {
		const out = injectEnv({
			command: "vitest",
			cwd,
			env: { ...env, VITEST_AGENT_PARENT_AGENT_ID: "parent-1" },
		});
		expect(out).toBe(
			"VITEST_AGENT_CONVERSATION_ID=c1 VITEST_AGENT_AGENT_ID=a1 VITEST_AGENT_PARENT_AGENT_ID=parent-1 vitest",
		);
	});

	it("survives a missing or malformed package.json", () => {
		// No package.json written. Direct vitest pattern still matches.
		const out = injectEnv({ command: "vitest run", cwd, env });
		expect(out).toBe("VITEST_AGENT_CONVERSATION_ID=c1 VITEST_AGENT_AGENT_ID=a1 vitest run");
	});

	it("returns original command when no Vitest pattern matches", () => {
		writePackageJson({ test: "vitest" });
		const out = injectEnv({ command: "ls -la", cwd, env });
		expect(out).toBe("ls -la");
	});
});
