/**
 * Spawn the built `vitest-agent-mcp` bin as a long-lived child process over
 * real stdio, through `@effected/mcp`'s `McpProcess` (`send`, `handshake`,
 * `readUntilResponse`, `closeStdin`, `exitCode`, `stderrSoFar`). This module
 * only adds what is specific to this server: where the built bin lives and a
 * scratch project + explicit environment so a spawned server never touches
 * the developer's real `data.db`.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { McpProcess } from "@effected/mcp/testing";
import type { Effect, PlatformError, Scope } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";
import { ChildProcess } from "effect/unstable/process";

/** The built dev bin, resolved from this file's own location, never from cwd. */
export const MCP_BIN: string = resolve(
	import.meta.dirname,
	"..",
	"..",
	"dist",
	"dev",
	"pkg",
	"bin",
	"vitest-agent-mcp.js",
);

/**
 * A throwaway project directory with a `package.json` name (the engine's
 * project identity) plus a private `XDG_DATA_HOME`, so a spawned server never
 * touches the developer's real `data.db`.
 */
export const makeScratchProject = (name = "mcp-e2e-scratch"): { projectDir: string; xdgDataHome: string } => {
	const root = mkdtempSync(join(tmpdir(), "va-mcp-e2e-"));
	const projectDir = join(root, "project");
	const xdgDataHome = join(root, "xdg-data");
	// The engine creates the XDG data dir on first use; the project dir must
	// carry its manifest up front.
	mkdirSync(projectDir, { recursive: true });
	writeFileSync(join(projectDir, "package.json"), `${JSON.stringify({ name, version: "0.0.0", private: true })}\n`);
	return { projectDir, xdgDataHome };
};

/**
 * The explicit environment for a spawned server. Never `extendEnv`: the
 * parent's `npm_*` / `VITEST_*` noise must not leak into the child.
 */
export const makeEnv = (
	scratch: { projectDir: string; xdgDataHome: string },
	extra: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string>> => ({
	PATH: process.env.PATH ?? "",
	HOME: process.env.HOME ?? "",
	NO_COLOR: "1",
	XDG_DATA_HOME: scratch.xdgDataHome,
	VITEST_AGENT_REPORTER_PROJECT_DIR: scratch.projectDir,
	...extra,
});

/** Spawn the built bin as a long-lived server with the given explicit env. */
export const spawnMcp = (
	env: Readonly<Record<string, string>>,
	args: ReadonlyArray<string> = [],
): Effect.Effect<McpProcess, PlatformError.PlatformError, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
	McpProcess.spawn(ChildProcess.make(process.execPath, [MCP_BIN, ...args], { env }));
