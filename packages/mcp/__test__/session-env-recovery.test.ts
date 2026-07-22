import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createSessionContextRef } from "../src/context.js";
import { parseSessionEnvExports, recoverSessionContextFromSessionEnv } from "../src/session-env.js";

const roots: string[] = [];

function makeRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "vitest-agent-session-env-"));
	roots.push(root);
	return root;
}

function writeSessionDir(
	root: string,
	chatId: string,
	opts: {
		projectDir: string;
		conversationId?: string;
		mainAgentId?: string;
		mtime?: Date;
		omit?: readonly string[];
	},
): void {
	const dir = join(root, chatId);
	mkdirSync(dir, { recursive: true });
	const lines: string[] = [];
	const vars: Record<string, string> = {
		VITEST_AGENT_CHAT_ID: chatId,
		VITEST_AGENT_CONVERSATION_ID: opts.conversationId ?? `conv-${chatId}`,
		VITEST_AGENT_MAIN_AGENT_ID: opts.mainAgentId ?? `agent-${chatId}`,
		VITEST_AGENT_AGENT_ID: opts.mainAgentId ?? `agent-${chatId}`,
		VITEST_AGENT_PROJECT_DIR: opts.projectDir,
	};
	for (const [k, v] of Object.entries(vars)) {
		if (opts.omit?.includes(k) === true) continue;
		lines.push(`export ${k}=${v}`);
	}
	const file = join(dir, "vitest-agent-hook.sh");
	writeFileSync(file, `${lines.join("\n")}\n`);
	if (opts.mtime !== undefined) {
		utimesSync(file, opts.mtime, opts.mtime);
	}
}

afterAll(() => {
	for (const root of roots) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe("parseSessionEnvExports", () => {
	it("parses bare export lines and ignores non-export lines", () => {
		const env = parseSessionEnvExports(
			["# comment", "export VITEST_AGENT_CHAT_ID=abc-123", "PLAIN=nope", "export VITEST_AGENT_PROJECT_DIR=/tmp/p"].join(
				"\n",
			),
		);
		expect(env.VITEST_AGENT_CHAT_ID).toBe("abc-123");
		expect(env.VITEST_AGENT_PROJECT_DIR).toBe("/tmp/p");
		expect(env.PLAIN).toBeUndefined();
	});

	it("unquotes printf %q output forms", () => {
		const env = parseSessionEnvExports(
			[
				"export VITEST_AGENT_PROJECT_DIR=/tmp/with\\ space",
				"export VITEST_AGENT_CHAT_ID='single-quoted'",
				'export VITEST_AGENT_CONVERSATION_ID="double-quoted"',
				"export VITEST_AGENT_MAIN_AGENT_ID=$'dollar-quoted'",
			].join("\n"),
		);
		expect(env.VITEST_AGENT_PROJECT_DIR).toBe("/tmp/with space");
		expect(env.VITEST_AGENT_CHAT_ID).toBe("single-quoted");
		expect(env.VITEST_AGENT_CONVERSATION_ID).toBe("double-quoted");
		expect(env.VITEST_AGENT_MAIN_AGENT_ID).toBe("dollar-quoted");
	});
});

describe("recoverSessionContextFromSessionEnv", () => {
	it("returns null when the session-env root does not exist", () => {
		expect(
			recoverSessionContextFromSessionEnv({
				projectDir: "/tmp/none",
				sessionEnvRoot: join(tmpdir(), "vitest-agent-does-not-exist"),
			}),
		).toBeNull();
	});

	it("recovers the context for the matching project dir", () => {
		const root = makeRoot();
		writeSessionDir(root, "chat-match", { projectDir: "/tmp/project-a" });
		writeSessionDir(root, "chat-other", { projectDir: "/tmp/project-b" });
		const ctx = recoverSessionContextFromSessionEnv({ projectDir: "/tmp/project-a", sessionEnvRoot: root });
		expect(ctx).toEqual({
			chatId: "chat-match",
			conversationId: "conv-chat-match",
			mainAgentId: "agent-chat-match",
		});
	});

	it("picks the newest-mtime session dir when several match the project", () => {
		const root = makeRoot();
		writeSessionDir(root, "chat-old", { projectDir: "/tmp/project-a", mtime: new Date("2026-07-01T00:00:00Z") });
		writeSessionDir(root, "chat-new", { projectDir: "/tmp/project-a", mtime: new Date("2026-07-02T00:00:00Z") });
		const ctx = recoverSessionContextFromSessionEnv({ projectDir: "/tmp/project-a", sessionEnvRoot: root });
		expect(ctx?.chatId).toBe("chat-new");
	});

	it("skips session dirs missing required UUID exports", () => {
		const root = makeRoot();
		writeSessionDir(root, "chat-incomplete", {
			projectDir: "/tmp/project-a",
			omit: ["VITEST_AGENT_CONVERSATION_ID"],
		});
		expect(recoverSessionContextFromSessionEnv({ projectDir: "/tmp/project-a", sessionEnvRoot: root })).toBeNull();
	});

	it("falls back to VITEST_AGENT_AGENT_ID when MAIN_AGENT_ID is absent", () => {
		const root = makeRoot();
		writeSessionDir(root, "chat-agent-only", {
			projectDir: "/tmp/project-a",
			omit: ["VITEST_AGENT_MAIN_AGENT_ID"],
		});
		const ctx = recoverSessionContextFromSessionEnv({ projectDir: "/tmp/project-a", sessionEnvRoot: root });
		expect(ctx?.mainAgentId).toBe("agent-chat-agent-only");
	});
});

describe("createSessionContextRef lazy recovery", () => {
	it("invokes recover while null and caches the first non-null result", () => {
		let calls = 0;
		const results = [null, { chatId: "c", conversationId: "v", mainAgentId: "a" }] as const;
		const ref = createSessionContextRef(null, () => {
			const r = results[Math.min(calls, 1)] ?? null;
			calls += 1;
			return r;
		});
		expect(ref.get()).toBeNull();
		expect(calls).toBe(1);
		expect(ref.get()?.chatId).toBe("c");
		expect(calls).toBe(2);
		// Cached — recover is not called again.
		expect(ref.get()?.chatId).toBe("c");
		expect(calls).toBe(2);
	});

	it("does not recover when constructed with an initial value", () => {
		let calls = 0;
		const ref = createSessionContextRef({ chatId: "boot", conversationId: "v", mainAgentId: "a" }, () => {
			calls += 1;
			return null;
		});
		expect(ref.get()?.chatId).toBe("boot");
		expect(calls).toBe(0);
	});

	it("set() overrides and stops further recovery", () => {
		let calls = 0;
		const ref = createSessionContextRef(null, () => {
			calls += 1;
			return null;
		});
		ref.set({ chatId: "explicit", conversationId: "v", mainAgentId: "a" });
		expect(ref.get()?.chatId).toBe("explicit");
		expect(calls).toBe(0);
	});
});
