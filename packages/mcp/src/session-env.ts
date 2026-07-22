/**
 * Call-time SessionContext recovery from the per-session env files the
 * plugin's SessionStart hook writes to `~/.claude/session-env/`.
 *
 * The boot-time env recovery (`sessionContextFromEnv`) depends on Claude
 * Code auto-sourcing `CLAUDE_ENV_FILE` into the MCP child — which loses
 * two races:
 *
 * 1. **Boot race.** On a fresh Claude Code launch the MCP child can spawn
 *    before the SessionStart hook has written `CLAUDE_ENV_FILE`, so the
 *    child's `process.env` never carries the canonical UUIDs (observed
 *    live: MCP spawn at 00:41:50, env file written 00:41:51).
 * 2. **`/reload-plugins`.** A plugin reload restarts the MCP server
 *    mid-session with a fresh environment that has no session exports.
 *
 * In both cases the SessionStart hook has (or will have) written the same
 * exports to a second, known-name surface:
 * `~/.claude/session-env/<chat_id>/vitest-agent-hook.sh`. This module
 * reads that surface directly, so a null boot context can be recovered
 * lazily at the first tool call that needs it.
 *
 * Selection rule: among all session dirs whose exports name this server's
 * `projectDir`, the newest-mtime file wins — the most recently started
 * session for this project. With two live Claude Code windows on the same
 * project this can name the other window's session; that ambiguity is
 * inherent to a per-project (not per-process) surface and is accepted —
 * the pre-existing alternative was no attribution at all.
 *
 * @packageDocumentation
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { SessionContext } from "./context.js";

const EXPORT_LINE = /^export ([A-Z_][A-Z0-9_]*)=(.*)$/;

/**
 * Undo the `printf '%q'` quoting the SessionStart hook applies to export
 * values. UUIDs and plain paths arrive bare; values with specials arrive
 * as `$'...'`, `'...'`, `"..."`, or backslash-escaped words.
 */
const unquote = (raw: string): string => {
	let v = raw.trim();
	if (v.startsWith("$'") && v.endsWith("'") && v.length >= 3) {
		v = v.slice(2, -1);
	} else if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
		if (v.length >= 2) v = v.slice(1, -1);
	}
	return v.replace(/\\(.)/g, "$1");
};

/**
 * Parse `export KEY=value` lines from a session-env hook file into a
 * plain record. Non-export lines are ignored.
 *
 * @param content - the raw text of a session-env hook file
 * @returns a record of export names to unquoted values
 * @public
 */
export const parseSessionEnvExports = (content: string): Record<string, string> => {
	const out: Record<string, string> = {};
	for (const line of content.split("\n")) {
		const m = EXPORT_LINE.exec(line.trim());
		if (m?.[1] !== undefined && m[2] !== undefined) {
			out[m[1]] = unquote(m[2]);
		}
	}
	return out;
};

/**
 * Recover a {@link SessionContext} from the newest session-env hook file
 * whose `VITEST_AGENT_PROJECT_DIR` matches `projectDir`.
 *
 * Returns `null` when the session-env root is missing, unreadable, or no
 * session dir matches the project. Never throws — recovery is best-effort
 * and callers fall back to their existing null-context behavior.
 *
 * @param opts - `projectDir` to match against; `sessionEnvRoot` overrides
 *   the default `~/.claude/session-env` (tests)
 * @public
 */
export const recoverSessionContextFromSessionEnv = (opts: {
	readonly projectDir: string;
	readonly sessionEnvRoot?: string;
}): SessionContext | null => {
	const root = opts.sessionEnvRoot ?? join(homedir(), ".claude", "session-env");
	const wantDir = resolve(opts.projectDir);
	let entries: string[];
	try {
		entries = readdirSync(root);
	} catch {
		return null;
	}
	let best: { mtimeMs: number; ctx: SessionContext } | null = null;
	for (const entry of entries) {
		const file = join(root, entry, "vitest-agent-hook.sh");
		try {
			const st = statSync(file);
			const env = parseSessionEnvExports(readFileSync(file, "utf8"));
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
			if (best === null || st.mtimeMs > best.mtimeMs) {
				best = { mtimeMs: st.mtimeMs, ctx: { chatId, conversationId, mainAgentId } };
			}
		} catch {
			// Missing or unreadable hook file in this session dir — skip.
		}
	}
	return best === null ? null : best.ctx;
};
