import { describe, expect, it } from "vitest";
import { injectEnv } from "../src/internal-inject-env.js";

const cwd = "/repo";

/**
 * In-memory `readFile`: serves `<cwd>/package.json` from `scripts` and
 * throws for every other path, the way a real `readFileSync` miss would.
 */
const readFileFor =
	(scripts?: Record<string, string>) =>
	(path: string): string => {
		if (scripts !== undefined && path === `${cwd}/package.json`) return JSON.stringify({ scripts });
		throw new Error(`ENOENT: no such file, open '${path}'`);
	};

describe("injectEnv", () => {
	const env = { VITEST_AGENT_CONVERSATION_ID: "c1", VITEST_AGENT_AGENT_ID: "a1" };

	it("returns the original command when no agent env is set", () => {
		const out = injectEnv({ command: "pnpm test", cwd, env: {}, readFile: readFileFor({ test: "vitest run" }) });
		expect(out).toBe("pnpm test");
	});

	it("returns the original command when only conversation_id is set", () => {
		const out = injectEnv({
			command: "vitest run",
			cwd,
			env: { VITEST_AGENT_CONVERSATION_ID: "c1" },
			readFile: readFileFor(),
		});
		expect(out).toBe("vitest run");
	});

	it("rewrites a direct vitest invocation", () => {
		const out = injectEnv({ command: "vitest run", cwd, env, readFile: readFileFor() });
		expect(out).toBe("VITEST_AGENT_CONVERSATION_ID=c1 VITEST_AGENT_AGENT_ID=a1 vitest run");
	});

	it("rewrites a pnpm test invocation when scripts.test mentions vitest", () => {
		const out = injectEnv({ command: "pnpm test", cwd, env, readFile: readFileFor({ test: "vitest run" }) });
		expect(out).toBe("VITEST_AGENT_CONVERSATION_ID=c1 VITEST_AGENT_AGENT_ID=a1 pnpm test");
	});

	it("reads package.json from `<cwd>/package.json` through the injected reader", () => {
		const seen: string[] = [];
		const readFile = (path: string): string => {
			seen.push(path);
			return JSON.stringify({ scripts: { test: "vitest" } });
		};
		injectEnv({ command: "pnpm test", cwd: "/some/where", env, readFile });
		expect(seen).toEqual(["/some/where/package.json"]);
	});

	it("does NOT rewrite pnpm build when scripts.build does not mention vitest", () => {
		const out = injectEnv({
			command: "pnpm build",
			cwd,
			env,
			readFile: readFileFor({ build: "tsc", test: "vitest" }),
		});
		expect(out).toBe("pnpm build");
	});

	it("appends PARENT_AGENT_ID when set in env (subagent case)", () => {
		const out = injectEnv({
			command: "vitest",
			cwd,
			env: { ...env, VITEST_AGENT_PARENT_AGENT_ID: "parent-1" },
			readFile: readFileFor(),
		});
		expect(out).toBe(
			"VITEST_AGENT_CONVERSATION_ID=c1 VITEST_AGENT_AGENT_ID=a1 VITEST_AGENT_PARENT_AGENT_ID=parent-1 vitest",
		);
	});

	it("survives a missing package.json (reader throws)", () => {
		const out = injectEnv({ command: "vitest run", cwd, env, readFile: readFileFor() });
		expect(out).toBe("VITEST_AGENT_CONVERSATION_ID=c1 VITEST_AGENT_AGENT_ID=a1 vitest run");
	});

	it("survives a malformed package.json", () => {
		const out = injectEnv({ command: "pnpm test", cwd, env, readFile: () => "{ not json" });
		expect(out).toBe("pnpm test");
	});

	it("returns original command when no Vitest pattern matches", () => {
		const out = injectEnv({ command: "ls -la", cwd, env, readFile: readFileFor({ test: "vitest" }) });
		expect(out).toBe("ls -la");
	});
});
