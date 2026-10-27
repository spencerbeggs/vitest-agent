// Call-time SessionContext recovery from the per-session env files the
// plugin's SessionStart hook writes to `~/.claude/session-env/`.
//
// The boot-time env recovery (`sessionContextFromEnv`) depends on Claude
// Code auto-sourcing `CLAUDE_ENV_FILE` into the MCP child — which loses
// two races:
//
// 1. **Boot race.** On a fresh Claude Code launch the MCP child can spawn
//    before the SessionStart hook has written `CLAUDE_ENV_FILE`, so the
//    child's `process.env` never carries the canonical UUIDs (observed
//    live: MCP spawn at 00:41:50, env file written 00:41:51).
// 2. **`/reload-plugins`.** A plugin reload restarts the MCP server
//    mid-session with a fresh environment that has no session exports.
//
// In both cases the SessionStart hook has (or will have) written the same
// exports to a second, known-name surface:
// `~/.claude/session-env/<chat_id>/vitest-agent-hook.sh`. This module
// reads that surface directly, so a null boot context can be recovered
// lazily at the first tool call that needs it.
//
// Selection rule: among all session dirs whose exports name this server's
// `projectDir`, the newest-mtime file wins — the most recently started
// session for this project. With two live Claude Code windows on the same
// project this can name the other window's session; that ambiguity is
// inherent to a per-project (not per-process) surface and is accepted —
// the pre-existing alternative was no attribution at all.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { ShellExports } from "@effected/env";
import { Result } from "effect";

/**
 * Recovered session attribution context — the canonical UUIDs the
 * SessionStart hook wrote to `${CLAUDE_ENV_FILE}` (auto-sourced into the
 * MCP server child's `process.env`) and to the per-session
 * `~/.claude/session-env/<chat_id>/vitest-agent-hook.sh` surface this
 * module reads back.
 *
 * Read by the MCP server's `run_tests` to populate `VITEST_AGENT_AGENT_ID`
 * and friends on the Vitest child process so the reporter attributes runs
 * back to the active agent.
 *
 * @public
 */
export interface SessionContext {
	readonly chatId: string;
	readonly conversationId: string;
	readonly mainAgentId: string;
}

/**
 * The synchronous filesystem reads {@link recoverSessionContextFromSessionEnv}
 * performs. Each member throws on a missing or unreadable path, exactly as
 * the `node:fs` call it stands in for; recovery treats a throw as "skip".
 *
 * @public
 */
export interface SessionEnvFileSystem {
	/** Entry names directly under `path` (`readdirSync`). */
	readonly readDirectory: (path: string) => ReadonlyArray<string>;
	/**
	 * The raw bytes of the file at `path` (`readFileSync(path)`). Bytes, not
	 * text: bash 3.2's `%q` mixes raw UTF-8 bytes with octal escapes inside
	 * one `$'…'`, which only a byte-level parse reads back as bash does.
	 */
	readonly readFile: (path: string) => Uint8Array;
	/** Modification time of the file at `path`, in epoch milliseconds (`statSync(path).mtimeMs`). */
	readonly mtimeMs: (path: string) => number;
}

/** The default {@link SessionEnvFileSystem}: the real disk through `node:fs`. */
const nodeSessionEnvFileSystem: SessionEnvFileSystem = {
	readDirectory: (path) => readdirSync(path),
	readFile: (path) => readFileSync(path),
	mtimeMs: (path) => statSync(path).mtimeMs,
};

/**
 * Recover a {@link SessionContext} from the newest session-env hook file
 * whose `VITEST_AGENT_PROJECT_DIR` matches `projectDir`.
 *
 * Returns `null` when the session-env root is missing, unreadable, or no
 * session dir matches the project. Never throws — recovery is best-effort
 * and callers fall back to their existing null-context behavior.
 *
 * Synchronous by contract: the MCP server calls it from the lazy
 * `SessionContextRef.get()` recover thunk, which is itself synchronous.
 *
 * @param opts - `projectDir` to match against; `homeDir` is the caller's
 *   home directory (ambient input — the MCP bin passes `os.homedir()`),
 *   under which `.claude/session-env` is read; `fileSystem` replaces the
 *   `node:fs` reads (tests pass an in-memory volume) and defaults to the
 *   real disk
 * @public
 */
export const recoverSessionContextFromSessionEnv = (opts: {
	readonly projectDir: string;
	readonly homeDir: string;
	readonly fileSystem?: SessionEnvFileSystem;
}): SessionContext | null => {
	const fs = opts.fileSystem ?? nodeSessionEnvFileSystem;
	const root = join(opts.homeDir, ".claude", "session-env");
	const wantDir = resolve(opts.projectDir);
	let entries: ReadonlyArray<string>;
	try {
		entries = fs.readDirectory(root);
	} catch {
		return null;
	}
	let best: { mtimeMs: number; ctx: SessionContext } | null = null;
	for (const entry of entries) {
		const file = join(root, entry, "vitest-agent-hook.sh");
		try {
			const mtimeMs = fs.mtimeMs(file);
			// `@effected/env`'s strict dialect: the `printf 'export K=%q'` lines
			// the SessionStart hook writes parse exactly as bash reads them
			// (`$'…'` escapes included). A file it rejects (a hand edit, CRLF, an
			// expansion) is not trusted at all: skip the dir, never half-read it.
			const parsed = ShellExports.parseBytesResult(fs.readFile(file));
			if (Result.isFailure(parsed)) continue;
			const env = parsed.success;
			const chatId = env.VITEST_AGENT_CHAT_ID;
			const conversationId = env.VITEST_AGENT_CONVERSATION_ID;
			const mainAgentId = env.VITEST_AGENT_MAIN_AGENT_ID ?? env.VITEST_AGENT_AGENT_ID;
			const fileProjectDir = env.VITEST_AGENT_PROJECT_DIR;
			if (
				chatId === undefined ||
				chatId.length === 0 ||
				conversationId === undefined ||
				conversationId.length === 0 ||
				mainAgentId === undefined ||
				mainAgentId.length === 0 ||
				fileProjectDir === undefined ||
				resolve(fileProjectDir) !== wantDir
			) {
				continue;
			}
			if (best === null || mtimeMs > best.mtimeMs) {
				best = { mtimeMs, ctx: { chatId, conversationId, mainAgentId } };
			}
		} catch {
			// Missing or unreadable hook file in this session dir — skip.
		}
	}
	return best === null ? null : best.ctx;
};
