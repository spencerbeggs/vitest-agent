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
	const env = {
		VITEST_AGENT_CONVERSATION_ID: "0b6f2a8e-4c1d-4e5f-9a7b-1c2d3e4f5a6b",
		VITEST_AGENT_AGENT_ID: "7d9e1f20-3a4b-4c5d-8e6f-a1b2c3d4e5f6",
	};

	it("returns the original command when no agent env is set", () => {
		const out = injectEnv({ command: "pnpm test", cwd, env: {}, readFile: readFileFor({ test: "vitest run" }) });
		expect(out).toBe("pnpm test");
	});

	it("returns the original command when only conversation_id is set", () => {
		const out = injectEnv({
			command: "vitest run",
			cwd,
			env: { VITEST_AGENT_CONVERSATION_ID: "0b6f2a8e-4c1d-4e5f-9a7b-1c2d3e4f5a6b" },
			readFile: readFileFor(),
		});
		expect(out).toBe("vitest run");
	});

	it("rewrites a direct vitest invocation", () => {
		const out = injectEnv({ command: "vitest run", cwd, env, readFile: readFileFor() });
		expect(out).toBe(
			"VITEST_AGENT_CONVERSATION_ID=0b6f2a8e-4c1d-4e5f-9a7b-1c2d3e4f5a6b VITEST_AGENT_AGENT_ID=7d9e1f20-3a4b-4c5d-8e6f-a1b2c3d4e5f6 vitest run",
		);
	});

	it("rewrites a pnpm test invocation when scripts.test mentions vitest", () => {
		const out = injectEnv({ command: "pnpm test", cwd, env, readFile: readFileFor({ test: "vitest run" }) });
		expect(out).toBe(
			"VITEST_AGENT_CONVERSATION_ID=0b6f2a8e-4c1d-4e5f-9a7b-1c2d3e4f5a6b VITEST_AGENT_AGENT_ID=7d9e1f20-3a4b-4c5d-8e6f-a1b2c3d4e5f6 pnpm test",
		);
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
			env: { ...env, VITEST_AGENT_PARENT_AGENT_ID: "c3a1e2b4-5d6f-4a7b-9c8d-e0f1a2b3c4d5" },
			readFile: readFileFor(),
		});
		expect(out).toBe(
			"VITEST_AGENT_CONVERSATION_ID=0b6f2a8e-4c1d-4e5f-9a7b-1c2d3e4f5a6b VITEST_AGENT_AGENT_ID=7d9e1f20-3a4b-4c5d-8e6f-a1b2c3d4e5f6 VITEST_AGENT_PARENT_AGENT_ID=c3a1e2b4-5d6f-4a7b-9c8d-e0f1a2b3c4d5 vitest",
		);
	});

	it("survives a missing package.json (reader throws)", () => {
		const out = injectEnv({ command: "vitest run", cwd, env, readFile: readFileFor() });
		expect(out).toBe(
			"VITEST_AGENT_CONVERSATION_ID=0b6f2a8e-4c1d-4e5f-9a7b-1c2d3e4f5a6b VITEST_AGENT_AGENT_ID=7d9e1f20-3a4b-4c5d-8e6f-a1b2c3d4e5f6 vitest run",
		);
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

describe("injectEnv — env-derived ids are spliced into a shell prefix", () => {
	const CONV = "0b6f2a8e-4c1d-4e5f-9a7b-1c2d3e4f5a6b";
	const AGENT = "7d9e1f20-3a4b-4c5d-8e6f-a1b2c3d4e5f6";
	const PARENT = "c3a1e2b4-5d6f-4a7b-9c8d-e0f1a2b3c4d5";
	const hostile = [
		["a space", `${AGENT} rm -rf ~`],
		["a semicolon", `${AGENT};touch /tmp/pwned`],
		["a command substitution", `$(touch /tmp/pwned)`],
		["a newline", `${AGENT}\ntouch /tmp/pwned`],
	] as const;

	it("rewrites a valid UUID set byte-for-byte as before", () => {
		const out = injectEnv({
			command: "vitest run",
			cwd,
			env: { VITEST_AGENT_CONVERSATION_ID: CONV, VITEST_AGENT_AGENT_ID: AGENT, VITEST_AGENT_PARENT_AGENT_ID: PARENT },
			readFile: readFileFor(),
		});
		expect(out).toBe(
			`VITEST_AGENT_CONVERSATION_ID=${CONV} VITEST_AGENT_AGENT_ID=${AGENT} VITEST_AGENT_PARENT_AGENT_ID=${PARENT} vitest run`,
		);
	});

	it("accepts an upper-case UUID unchanged", () => {
		const upper = AGENT.toUpperCase();
		const out = injectEnv({
			command: "vitest run",
			cwd,
			env: { VITEST_AGENT_CONVERSATION_ID: CONV, VITEST_AGENT_AGENT_ID: upper },
			readFile: readFileFor(),
		});
		expect(out).toBe(`VITEST_AGENT_CONVERSATION_ID=${CONV} VITEST_AGENT_AGENT_ID=${upper} vitest run`);
	});

	for (const [label, bad] of hostile) {
		it(`leaves the command unchanged when the agent id contains ${label}`, () => {
			const out = injectEnv({
				command: "vitest run",
				cwd,
				env: { VITEST_AGENT_CONVERSATION_ID: CONV, VITEST_AGENT_AGENT_ID: bad },
				readFile: readFileFor(),
			});
			expect(out).toBe("vitest run");
		});

		it(`leaves the command unchanged when the conversation id contains ${label}`, () => {
			const out = injectEnv({
				command: "vitest run",
				cwd,
				env: { VITEST_AGENT_CONVERSATION_ID: bad, VITEST_AGENT_AGENT_ID: AGENT },
				readFile: readFileFor(),
			});
			expect(out).toBe("vitest run");
		});

		it(`omits only the parent assignment when the parent id contains ${label}`, () => {
			const out = injectEnv({
				command: "vitest run",
				cwd,
				env: { VITEST_AGENT_CONVERSATION_ID: CONV, VITEST_AGENT_AGENT_ID: AGENT, VITEST_AGENT_PARENT_AGENT_ID: bad },
				readFile: readFileFor(),
			});
			expect(out).toBe(`VITEST_AGENT_CONVERSATION_ID=${CONV} VITEST_AGENT_AGENT_ID=${AGENT} vitest run`);
		});
	}

	it("rejects an id that is a UUID with trailing content", () => {
		const out = injectEnv({
			command: "vitest run",
			cwd,
			env: { VITEST_AGENT_CONVERSATION_ID: CONV, VITEST_AGENT_AGENT_ID: `${AGENT}x` },
			readFile: readFileFor(),
		});
		expect(out).toBe("vitest run");
	});
});
