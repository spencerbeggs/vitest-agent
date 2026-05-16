#!/usr/bin/env node
/**
 * `vitest-agent-sidecar` binary entry point.
 *
 * The argv dispatcher for the SEA binary. Two subcommands:
 *
 *   - `inject-env`     — pure, fast: rewrites a Bash command with the
 *                        `VITEST_AGENT_*` env prefix on a Vitest match.
 *   - `register-agent` — touches SQLite via the CLI's `SidecarLive`
 *                        layer; registers an agent invocation.
 *
 * Argv parsing is hand-rolled and dependency-free on purpose — pulling
 * `@effect/cli` into the SEA bundle would bloat it for no benefit. The
 * dispatch logic is the exported {@link dispatch} function so it can be
 * unit-tested without spawning a process; the module bottom invokes it
 * with `process.argv` only when run as the program entry.
 *
 * Error contract: on an unknown subcommand or a thrown error the
 * dispatcher writes `<exitCode> <tag>: <message>` to stderr and exits
 * with the code from `exitCodeForTag` (0 success, 1 conflict, 2
 * timeout, 3 db error, 4 identity unresolvable, 5 other).
 *
 * @packageDocumentation
 */

import { createRequire } from "node:module";
import { exitCodeForTag } from "vitest-agent-cli";
import { injectEnv } from "./inject-env.js";
import { runRegisterAgent } from "./register-agent.js";

/** Result of a {@link dispatch} call: captured stdout/stderr + exit code. */
export interface DispatchResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly code: number;
}

/**
 * Parse `--flag value` pairs from an argv slice into a plain record.
 * Bare tokens and unknown shapes are ignored — the subcommand handlers
 * read only the flags they expect.
 */
const parseFlags = (argv: readonly string[]): Record<string, string> => {
	const flags: Record<string, string> = {};
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (token !== undefined && token.startsWith("--")) {
			const key = token.slice(2);
			const next = argv[i + 1];
			if (next !== undefined && !next.startsWith("--")) {
				flags[key] = next;
				i += 1;
			} else {
				flags[key] = "";
			}
		}
	}
	return flags;
};

const tagFromError = (err: unknown): string => {
	if (err !== null && typeof err === "object" && "_tag" in err && typeof err._tag === "string") {
		return err._tag;
	}
	return "Defect";
};

const messageFromError = (err: unknown): string => {
	if (err instanceof Error) return err.message;
	if (err !== null && typeof err === "object") {
		const e = err as { reason?: unknown; message?: unknown };
		if (typeof e.reason === "string") return e.reason;
		if (typeof e.message === "string") return e.message;
	}
	return String(err ?? "unknown error");
};

/**
 * Dispatch one argv invocation. `argv` is the post-`node post-bin`
 * slice — i.e. `process.argv.slice(2)`. Never throws: every failure is
 * folded into the returned {@link DispatchResult}.
 */
export const dispatch = async (argv: readonly string[]): Promise<DispatchResult> => {
	const subcommand = argv[0];
	const rest = argv.slice(1);

	if (subcommand === "inject-env") {
		const flags = parseFlags(rest);
		const command = flags.command;
		const cwd = flags.cwd ?? process.cwd();
		if (command === undefined) {
			return {
				stdout: "",
				stderr: `${exitCodeForTag("Defect")} Defect: inject-env requires --command\n`,
				code: exitCodeForTag("Defect"),
			};
		}
		try {
			const out = injectEnv({ command, cwd, env: process.env });
			return { stdout: `${out}\n`, stderr: "", code: 0 };
		} catch (err) {
			const tag = tagFromError(err);
			return {
				stdout: "",
				stderr: `${exitCodeForTag(tag)} ${tag}: ${messageFromError(err)}\n`,
				code: exitCodeForTag(tag),
			};
		}
	}

	if (subcommand === "register-agent") {
		const flags = parseFlags(rest);
		const required = ["host-kind", "agent-type", "host-session-id", "transcript-path"] as const;
		const missing = required.filter((name) => flags[name] === undefined);
		if (missing.length > 0) {
			return {
				stdout: "",
				stderr: `${exitCodeForTag("Defect")} Defect: register-agent missing required flag(s): ${missing.join(", ")}\n`,
				code: exitCodeForTag("Defect"),
			};
		}
		try {
			const result = await runRegisterAgent({
				hostKind: flags["host-kind"] as string,
				agentType: flags["agent-type"] as string,
				hostSessionId: flags["host-session-id"] as string,
				transcriptPath: flags["transcript-path"] as string,
				cwd: flags.cwd ?? process.cwd(),
				...(flags["parent-agent-id"] !== undefined && { parentAgentId: flags["parent-agent-id"] }),
				...(flags["client-nonce"] !== undefined && { clientNonce: flags["client-nonce"] }),
				...(flags["project-key"] !== undefined && { projectKey: flags["project-key"] }),
			});
			return { stdout: `${JSON.stringify(result)}\n`, stderr: "", code: 0 };
		} catch (err) {
			const tag = tagFromError(err);
			return {
				stdout: "",
				stderr: `${exitCodeForTag(tag)} ${tag}: ${messageFromError(err)}\n`,
				code: exitCodeForTag(tag),
			};
		}
	}

	const label = subcommand ?? "(none)";
	return {
		stdout: "",
		stderr: `${exitCodeForTag("Defect")} Defect: unknown subcommand: ${label}\n`,
		code: exitCodeForTag("Defect"),
	};
};

/**
 * Run {@link dispatch} against `process.argv`, flush its captured
 * streams to the real stdout/stderr, and exit with its code.
 */
const main = async (): Promise<void> => {
	const result = await dispatch(process.argv.slice(2));
	if (result.stdout.length > 0) process.stdout.write(result.stdout);
	if (result.stderr.length > 0) process.stderr.write(result.stderr);
	process.exit(result.code);
};

/**
 * True when this module is the program entry and should run `main()`.
 *
 * Inside a SEA binary the bundle is always the entry — `node:sea`'s
 * `isSea()` is the authoritative signal there, and `process.argv[1]`
 * is unreliable (often undefined). For a plain `node dist/bin.mjs`
 * invocation the argv-path comparison handles it. Importing this
 * module from the unit tests must NOT trigger a `process.exit`; the
 * `VITEST` env var (set by the test runner) and the
 * `VITEST_AGENT_SIDECAR_NO_MAIN` escape hatch both suppress `main()`.
 */
const isEntry = (): boolean => {
	if (process.env.VITEST_AGENT_SIDECAR_NO_MAIN === "1") return false;
	if (process.env.VITEST !== undefined) return false;
	try {
		// `node:sea` is only resolvable on Node >= 21; inside the SEA it
		// always is. A failed require means we are not in a SEA.
		const nodeRequire = createRequire(import.meta.url);
		const sea = nodeRequire("node:sea") as { isSea?: () => boolean };
		if (typeof sea.isSea === "function" && sea.isSea()) return true;
	} catch {
		// Not running inside a SEA — fall through to the argv check.
	}
	const entry = process.argv[1];
	if (entry === undefined) return false;
	const normalizedEntry = entry.replace(/\\/g, "/");
	return import.meta.url.endsWith(normalizedEntry) || normalizedEntry.endsWith("bin.js");
};

if (isEntry()) {
	void main();
}
