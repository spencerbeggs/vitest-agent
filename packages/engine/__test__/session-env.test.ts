import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { describe, expect, it } from "vitest";
import type { SessionEnvFileSystem } from "../src/programs/session-env.js";
import { parseSessionEnvExports, recoverSessionContextFromSessionEnv } from "../src/programs/session-env.js";

/** The fake home every volume case reads `.claude/session-env` under. */
const HOME = "/home/user";
const ROOT = join(HOME, ".claude", "session-env");

interface SessionDirOptions {
	readonly projectDir: string;
	readonly conversationId?: string;
	readonly mainAgentId?: string;
	/** Epoch milliseconds for the hook file's mtime. */
	readonly mtime?: number;
	readonly omit?: readonly string[];
}

/** The `export KEY=value` body the SessionStart hook writes for `chatId`. */
function hookFileBody(chatId: string, opts: SessionDirOptions): string {
	const vars: Record<string, string> = {
		VITEST_AGENT_CHAT_ID: chatId,
		VITEST_AGENT_CONVERSATION_ID: opts.conversationId ?? `conv-${chatId}`,
		VITEST_AGENT_MAIN_AGENT_ID: opts.mainAgentId ?? `agent-${chatId}`,
		VITEST_AGENT_AGENT_ID: opts.mainAgentId ?? `agent-${chatId}`,
		VITEST_AGENT_PROJECT_DIR: opts.projectDir,
	};
	const lines = Object.entries(vars)
		.filter(([k]) => opts.omit?.includes(k) !== true)
		.map(([k, v]) => `export ${k}=${v}`);
	return `${lines.join("\n")}\n`;
}

/** Seed entry for one session dir's hook file under {@link ROOT}. */
function sessionDir(chatId: string, opts: SessionDirOptions): MemoryFileSystemSeed {
	return {
		[join(ROOT, chatId, "vitest-agent-hook.sh")]: MemoryFileSystem.file(
			hookFileBody(chatId, opts),
			opts.mtime === undefined ? undefined : { mtime: opts.mtime },
		),
	};
}

/** A {@link SessionEnvFileSystem} over an in-memory volume seeded with `seed`. */
function volumeFs(seed: MemoryFileSystemSeed): SessionEnvFileSystem {
	const { sync } = MemoryFileSystem.makeSync(seed);
	return { readDirectory: sync.readDirectory, readFile: sync.readFile, mtimeMs: (path) => sync.stat(path).mtimeMs };
}

const recover = (projectDir: string, seed: MemoryFileSystemSeed) =>
	recoverSessionContextFromSessionEnv({ projectDir, homeDir: HOME, fileSystem: volumeFs(seed) });

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
		expect(recover("/tmp/none", { [HOME]: MemoryFileSystem.directory() })).toBeNull();
	});

	it("recovers the context for the matching project dir", () => {
		const ctx = recover("/tmp/project-a", {
			...sessionDir("chat-match", { projectDir: "/tmp/project-a" }),
			...sessionDir("chat-other", { projectDir: "/tmp/project-b" }),
		});
		expect(ctx).toEqual({
			chatId: "chat-match",
			conversationId: "conv-chat-match",
			mainAgentId: "agent-chat-match",
		});
	});

	it("picks the newest-mtime session dir when several match the project", () => {
		// Seeded newest-first so a first-match (entry-order) pick would name the wrong dir either way.
		const newestFirst = recover("/tmp/project-a", {
			...sessionDir("chat-new", { projectDir: "/tmp/project-a", mtime: Date.parse("2026-07-02T00:00:00Z") }),
			...sessionDir("chat-old", { projectDir: "/tmp/project-a", mtime: Date.parse("2026-07-01T00:00:00Z") }),
		});
		const oldestFirst = recover("/tmp/project-a", {
			...sessionDir("chat-old", { projectDir: "/tmp/project-a", mtime: Date.parse("2026-07-01T00:00:00Z") }),
			...sessionDir("chat-new", { projectDir: "/tmp/project-a", mtime: Date.parse("2026-07-02T00:00:00Z") }),
		});
		expect(newestFirst?.chatId).toBe("chat-new");
		expect(oldestFirst?.chatId).toBe("chat-new");
	});

	it("skips session dirs missing required UUID exports", () => {
		const seed = sessionDir("chat-incomplete", {
			projectDir: "/tmp/project-a",
			omit: ["VITEST_AGENT_CONVERSATION_ID"],
		});
		expect(recover("/tmp/project-a", seed)).toBeNull();
	});

	it("skips a session dir with no hook file and still recovers a sibling", () => {
		const ctx = recover("/tmp/project-a", {
			[join(ROOT, "chat-empty")]: MemoryFileSystem.directory(),
			...sessionDir("chat-ok", { projectDir: "/tmp/project-a" }),
		});
		expect(ctx?.chatId).toBe("chat-ok");
	});

	it("falls back to VITEST_AGENT_AGENT_ID when MAIN_AGENT_ID is absent", () => {
		const ctx = recover(
			"/tmp/project-a",
			sessionDir("chat-agent-only", { projectDir: "/tmp/project-a", omit: ["VITEST_AGENT_MAIN_AGENT_ID"] }),
		);
		expect(ctx?.mainAgentId).toBe("agent-chat-agent-only");
	});
});

// Real-disk smoke for the default `node:fs` port the MCP bin uses: readdir,
// stat mtime, and read all go through node, and the newest mtime wins.
describe("recoverSessionContextFromSessionEnv (node:fs default)", () => {
	it("recovers the newest matching session from a real home dir", () => {
		const home = mkdtempSync(join(tmpdir(), "vitest-agent-session-env-"));
		try {
			const writeHook = (chatId: string, projectDir: string, mtime: Date) => {
				const dir = join(home, ".claude", "session-env", chatId);
				mkdirSync(dir, { recursive: true });
				const file = join(dir, "vitest-agent-hook.sh");
				writeFileSync(file, hookFileBody(chatId, { projectDir }));
				utimesSync(file, mtime, mtime);
			};
			writeHook("chat-new", "/tmp/project-a", new Date("2026-07-02T00:00:00Z"));
			writeHook("chat-old", "/tmp/project-a", new Date("2026-07-01T00:00:00Z"));
			writeHook("chat-other", "/tmp/project-b", new Date("2026-07-03T00:00:00Z"));
			expect(recoverSessionContextFromSessionEnv({ projectDir: "/tmp/project-a", homeDir: home })).toEqual({
				chatId: "chat-new",
				conversationId: "conv-chat-new",
				mainAgentId: "agent-chat-new",
			});
			expect(
				recoverSessionContextFromSessionEnv({ projectDir: "/tmp/project-a", homeDir: join(home, "missing") }),
			).toBeNull();
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
