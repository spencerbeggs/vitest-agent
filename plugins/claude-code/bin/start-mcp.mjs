#!/usr/bin/env node
/**
 * Plugin MCP server loader.
 *
 * Detects the user's package manager and spawns
 * `vitest-agent-mcp` through it. The package manager handles
 * binary resolution (node_modules/.bin lookup, monorepo hoisting, etc.)
 * and we just forward stdio so Claude Code talks to the MCP subprocess
 * directly.
 *
 * Zero runtime dependencies on purpose — this script must work without
 * an `npm install`. It resolves the user's project from
 * `CLAUDE_PROJECT_DIR` (falling back to `process.cwd()`), detects the
 * package manager from a `packageManager` field or lockfile, then
 * spawns the bin. On non-zero exit (typically a missing peer dep) it
 * prints install instructions for the detected PM and exits with the
 * same code.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BIN_NAME = "vitest-agent-mcp";

/** @type {Record<string, { cmd: string; args: string[]; install: string }>} */
const PM = {
	npm: { cmd: "npx", args: ["--no-install"], install: "npm install --save-dev @vitest-agent/plugin" },
	pnpm: { cmd: "pnpm", args: ["exec"], install: "pnpm add -D @vitest-agent/plugin" },
	yarn: { cmd: "yarn", args: ["run"], install: "yarn add -D @vitest-agent/plugin" },
	bun: { cmd: "bun", args: ["x"], install: "bun add -d @vitest-agent/plugin" },
};

const LOCKFILES = [
	["pnpm-lock.yaml", "pnpm"],
	["bun.lock", "bun"],
	["bun.lockb", "bun"],
	["yarn.lock", "yarn"],
	["package-lock.json", "npm"],
];

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

/**
 * Detect the user's package manager. Order:
 *  1. `packageManager` field in `<projectDir>/package.json`
 *  2. Lockfile presence in `projectDir`
 *  3. Default to `npm`
 */
const detectPm = (dir) => {
	const pkgPath = join(dir, "package.json");
	if (existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
			if (typeof pkg.packageManager === "string") {
				const name = pkg.packageManager.split("@")[0];
				if (name in PM) return name;
			}
		} catch {
			// Fall through to lockfile detection.
		}
	}
	for (const [lockfile, pm] of LOCKFILES) {
		if (existsSync(join(dir, lockfile))) return pm;
	}
	return "npm";
};

const pmName = detectPm(projectDir);
const pm = PM[pmName];

// Forward the resolved project root so the MCP server uses the right
// workspace root for path resolution. Claude Code does not reliably
// propagate CLAUDE_PROJECT_DIR to MCP server subprocesses.
const env = { ...process.env, VITEST_AGENT_REPORTER_PROJECT_DIR: projectDir };

// Forward additional positional args (e.g. an initial session id seeded
// via ${CLAUDE_SESSION_ID} substitution in plugin.json's mcpServers.args).
// process.argv[0] is node, [1] is this script, [2..] is everything after
// the loader script in the manifest. Pass them through verbatim so the
// MCP bin sees them as its own argv.
const extraArgs = process.argv.slice(2);
const child = spawn(pm.cmd, [...pm.args, BIN_NAME, ...extraArgs], {
	cwd: projectDir,
	stdio: "inherit",
	env,
});

child.on("error", (err) => {
	process.stderr.write(
		[
			`vitest-agent plugin: failed to invoke '${pm.cmd}'.`,
			"",
			`Detected package manager: ${pmName}`,
			`Project directory: ${projectDir}`,
			"",
			`Make sure '${pm.cmd}' is on your PATH.`,
			`Install ${BIN_NAME} as a project dependency:`,
			`  ${pm.install}`,
			"",
			`Details: ${err.message}`,
			"",
		].join("\n"),
	);
	process.exit(1);
});

child.on("exit", (code, signal) => {
	if (code === 0) {
		process.exit(0);
	}
	if (signal) {
		// Re-raise the signal on this process so the parent sees the right termination cause.
		process.kill(process.pid, signal);
		return;
	}
	process.stderr.write(
		[
			`vitest-agent plugin: ${pm.cmd} ${pm.args.join(" ")} ${BIN_NAME} exited with code ${code}.`,
			"",
			`Detected package manager: ${pmName}`,
			`Project directory: ${projectDir}`,
			"",
			`If '${BIN_NAME}' is not installed, add it to your project:`,
			`  ${pm.install}`,
			"",
		].join("\n"),
	);
	process.exit(code ?? 1);
});
