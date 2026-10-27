/**
 * The `RunOnce` settings behind `AgentPlugin.runScript` (issue #191). The
 * lock protocol itself — exclusive create, nonce-observed trust, pid-and-host
 * probed takeover, owner-only release — is `@effected/commands`' `RunOnce`;
 * this module only derives the key, the directory and the timings one
 * `runScript` call runs under.
 *
 * @packageDocumentation
 */

import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RunOnceOptions } from "@effected/commands";
import { findWorkspaceRootSync } from "@effected/workspaces";
import { nodeSyncOps } from "@effected/workspaces/node-sync";

/** Floor for the poll interval, matching the floor `RunOnce` itself enforces. */
const MIN_LOCK_POLL_MS = 10;

/**
 * Strictly parses a millisecond timing supplied through one of the
 * `VITEST_AGENT_RUNSCRIPT_*` env overrides, answering `undefined` (the
 * `RunOnce` default) for anything that is not a whole positive integer at or
 * above `minimum`.
 *
 * `Number.parseInt` is deliberately not used on its own: it happily accepts
 * `"200ms"` (→ 200), `"-1"` and `"0"`, and `RunOnce` treats a non-positive or
 * sub-10ms timing as a wiring defect and throws. An unusable override falls
 * back to the default instead.
 */
export function parseLockTimingOverride(raw: string | undefined, minimum = 1): number | undefined {
	if (raw === undefined) return undefined;
	const trimmed = raw.trim();
	// Whole-string digits only: rejects "200ms", "1e3", "1.5", "-1", "+1", "".
	if (!/^\d+$/.test(trimmed)) return undefined;
	const parsed = Number.parseInt(trimmed, 10);
	if (!Number.isSafeInteger(parsed) || parsed < minimum) return undefined;
	return parsed;
}

/**
 * The directory `runScript` locks and done-markers live in:
 * `$XDG_DATA_HOME/vitest-agent/runscript-locks`, else the `~/.local/share`
 * fallback the `data.db` convention documents.
 *
 * @remarks
 * `RunOnce` recommends a host-local runtime or state directory over a data
 * directory. The plugin has no `@effected/xdg` dependency to resolve one, so
 * the location stays where 2.x put it.
 */
export function resolveRunScriptLockDir(env: NodeJS.ProcessEnv, home: string = homedir()): string {
	const xdg = env.XDG_DATA_HOME;
	const base = xdg !== undefined && xdg.length > 0 ? xdg : join(home, ".local", "share");
	return join(base, "vitest-agent", "runscript-locks");
}

/**
 * The lock key for one command in one workspace: a SHA-256 over the
 * workspace root and the command. Keyed on the root rather than the caller's
 * cwd, so per-package `vitest` runs in one monorepo serialize the same root
 * build (the #191 race). A string command and an argv command never share a
 * key: the argv form hashes its JSON encoding.
 */
export function runScriptLockKey(root: string, command: string | ReadonlyArray<string>): string {
	const identity = typeof command === "string" ? `sh\n${command}` : `argv\n${JSON.stringify(command)}`;
	return `runscript-${createHash("sha256").update(`${root}\n${identity}`).digest("hex").slice(0, 32)}`;
}

/**
 * The `RunOnce` options one `runScript` call runs under, from the caller's
 * cwd and environment. The workspace root falls back to `cwd` outside a
 * workspace.
 *
 * @remarks
 * `VITEST_AGENT_RUNSCRIPT_LOCK_STALE_MS`, `_LOCK_WAIT_TIMEOUT_MS` and
 * `_LOCK_POLL_MS` tune the protocol (the concurrency e2e suite shortens
 * them). `VITEST_AGENT_RUNSCRIPT_BUILT_RECENTLY_MS` is an opt-in: set, a done
 * marker that young is trusted even from a previous sequential run; unset, a
 * marker is trusted only from an owner this caller watched hold the lock.
 */
export function runScriptOptions(
	command: string | ReadonlyArray<string>,
	cwd: string,
	env: NodeJS.ProcessEnv,
): RunOnceOptions {
	const root = findWorkspaceRootSync(cwd, nodeSyncOps) ?? cwd;
	const staleMs = parseLockTimingOverride(env.VITEST_AGENT_RUNSCRIPT_LOCK_STALE_MS);
	const waitTimeoutMs = parseLockTimingOverride(env.VITEST_AGENT_RUNSCRIPT_LOCK_WAIT_TIMEOUT_MS);
	const pollMs = parseLockTimingOverride(env.VITEST_AGENT_RUNSCRIPT_LOCK_POLL_MS, MIN_LOCK_POLL_MS);
	const trustSequentialMs = parseLockTimingOverride(env.VITEST_AGENT_RUNSCRIPT_BUILT_RECENTLY_MS);
	return {
		key: runScriptLockKey(root, command),
		dir: resolveRunScriptLockDir(env),
		...(staleMs !== undefined ? { staleMs } : {}),
		...(waitTimeoutMs !== undefined ? { waitTimeoutMs } : {}),
		...(pollMs !== undefined ? { pollMs } : {}),
		...(trustSequentialMs !== undefined ? { trustSequentialMs } : {}),
	};
}

/**
 * How a shell-string command runs: the platform shell `execSync` used, now
 * spawned explicitly so `RunOnce` stays argv-only. On Windows it is exactly
 * what Node's `shell` option spawns: `cmd.exe /d /s /c "<command>"` with
 * verbatim arguments, so `cmd` (not Node's argv escaping) parses the quotes.
 */
export function shellCommand(
	command: string,
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv,
): { readonly argv: [string, ...string[]]; readonly windowsVerbatimArguments?: boolean } {
	return platform === "win32"
		? { argv: [env.ComSpec ?? "cmd.exe", "/d", "/s", "/c", `"${command}"`], windowsVerbatimArguments: true }
		: { argv: ["/bin/sh", "-c", command] };
}
