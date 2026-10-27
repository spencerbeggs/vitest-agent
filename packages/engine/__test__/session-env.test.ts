import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { describe, expect, it } from "vitest";
import type { SessionEnvFileSystem } from "../src/programs/session-env.js";
import { recoverSessionContextFromSessionEnv } from "../src/programs/session-env.js";

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
	const { sync, volume } = MemoryFileSystem.makeSync(seed);
	return {
		readDirectory: sync.readDirectory,
		readFile: (path) => {
			const bytes = volume.bytes(path);
			if (bytes === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
			return bytes;
		},
		mtimeMs: (path) => sync.stat(path).mtimeMs,
	};
}

const recover = (projectDir: string, seed: MemoryFileSystemSeed) =>
	recoverSessionContextFromSessionEnv({ projectDir, homeDir: HOME, fileSystem: volumeFs(seed) });

/** A hook file seeded with exactly `body` for `chatId`. */
const rawSessionDir = (chatId: string, body: string | Uint8Array): MemoryFileSystemSeed => ({
	[join(ROOT, chatId, "vitest-agent-hook.sh")]: MemoryFileSystem.file(body),
});

describe("session-env file parsing", () => {
	it("reads every printf %q form bash 3.2 and 5.x write, as bash reads them back", () => {
		// Captured from `printf 'export K=%q\n'` under /bin/bash 3.2 and bash 5.3.
		const ctx = recover("/tmp/with space/(p) & $x ~t *s", {
			...rawSessionDir(
				"chat-q",
				[
					"export VITEST_AGENT_CHAT_ID=chat-q",
					"export VITEST_AGENT_CONVERSATION_ID=''",
					"export VITEST_AGENT_CONVERSATION_ID=c",
					"export VITEST_AGENT_MAIN_AGENT_ID=$'agent\\nline\\ttab'",
					'export VITEST_AGENT_AGENT_ID=quote\\\'s\\ and\\ \\"dq\\"',
					"export VITEST_AGENT_PROJECT_DIR=/tmp/with\\ space/\\(p\\)\\ \\&\\ \\$x\\ ~t\\ \\*s",
					"",
				].join("\n"),
			),
		});
		expect(ctx).toEqual({ chatId: "chat-q", conversationId: "c", mainAgentId: "agent\nline\ttab" });

		const full = recover("/tmp/with space", {
			...rawSessionDir(
				"chat-q",
				[
					"export VITEST_AGENT_CHAT_ID=chat-q",
					"export VITEST_AGENT_CONVERSATION_ID='conv'",
					"export VITEST_AGENT_MAIN_AGENT_ID=$'agent\\nline'",
					"export VITEST_AGENT_PROJECT_DIR=/tmp/with\\ space",
					"",
				].join("\n"),
			),
		});
		// `$'…'` decodes `\n` to a newline (the former hand parser read it as `n`).
		expect(full).toEqual({ chatId: "chat-q", conversationId: "conv", mainAgentId: "agent\nline" });
	});

	it("reads bash 3.2's mixed raw-byte and octal %q output for non-ASCII values", () => {
		// Captured from `/bin/bash` 3.2 `printf 'export K=%q\n' "日本"`: inside one
		// `$'…'` it writes some bytes raw and others as octal escapes.
		const head = new TextEncoder().encode(
			[
				"export VITEST_AGENT_CHAT_ID=chat-j",
				"export VITEST_AGENT_CONVERSATION_ID=conv",
				"export VITEST_AGENT_PROJECT_DIR=/tmp/p",
				"export VITEST_AGENT_MAIN_AGENT_ID=$'",
			].join("\n"),
		);
		const octal = (text: string) => new TextEncoder().encode(text);
		const value = Uint8Array.from([0xe6, ...octal("\\227"), 0xa5, 0xe6, ...octal("\\234"), 0xac]);
		const tail = new TextEncoder().encode("'\n");
		const body = new Uint8Array([...head, ...value, ...tail]);
		expect(recover("/tmp/p", rawSessionDir("chat-j", body))).toEqual({
			chatId: "chat-j",
			conversationId: "conv",
			mainAgentId: "日本",
		});
	});

	it("does not trust a file the strict dialect rejects: no partial read", () => {
		const good = [
			"export VITEST_AGENT_CHAT_ID=chat-x",
			"export VITEST_AGENT_CONVERSATION_ID=conv",
			"export VITEST_AGENT_MAIN_AGENT_ID=agent",
			"export VITEST_AGENT_PROJECT_DIR=/tmp/p",
		];
		expect(recover("/tmp/p", rawSessionDir("chat-x", `${good.join("\n")}\n`))).not.toBeNull();
		for (const bad of [
			`${good.join("\r\n")}\r\n`,
			`${good.join("\n")}\nPLAIN=nope\n`,
			`${good.join("\n")}\nexport HOME_COPY=$HOME\n`,
		]) {
			expect(recover("/tmp/p", rawSessionDir("chat-x", bad))).toBeNull();
		}
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
