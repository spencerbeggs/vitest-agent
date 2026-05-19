/**
 * Sidecar argv dispatcher.
 *
 * The pure argv-dispatch core of the `vitest-agent-sidecar` native
 * binary. One subcommand:
 *
 *   - `inject-env` — pure, fast: rewrites a Bash command with the
 *                    `VITEST_AGENT_*` env prefix on a Vitest match.
 *
 * `inject-env` is the per-Bash-call hot path and is fully self-contained
 * — no SQLite, no native addon. `register-agent` deliberately stays on
 * the full `vitest-agent-cli` JS path: it pulls in a native SQLite
 * binding that cannot be bundled into a JS SEA, and it fires only once
 * per session (off the per-turn critical path). Putting `register-agent`
 * back in the binary is tracked as a 2.x follow-up.
 *
 * This lives in `vitest-agent-sdk` and ships from the dedicated
 * `vitest-agent-sdk/dispatch` entry point, so the four
 * `vitest-agent-sidecar-<platform>` child packages consume it as a
 * clean package import. `vitest-agent-sdk` is a true leaf package,
 * which keeps the workspace dependency graph acyclic — the
 * per-platform packages no longer close a cli → sidecar →
 * sidecar-platform → cli loop. Its only dependencies are sdk-local:
 * `injectEnv` and `exitCodeForTag`.
 *
 * The narrow entry point matters for binary size: importing from the
 * sdk main barrel would force the SEA bundler to tree-shake away the
 * Effect runtime, the SQLite data layer, and every service. The
 * dedicated entry guarantees the minimal reachable graph.
 *
 * Argv parsing is hand-rolled and dependency-free on purpose — pulling
 * `@effect/cli` into the SEA bundle would bloat it for no benefit.
 * {@link dispatch} is exported so it can be unit-tested without
 * spawning a process.
 *
 * Error contract: on an unknown subcommand or a thrown error the
 * dispatcher writes `<exitCode> <tag>: <message>` to stderr and exits
 * with the code from `exitCodeForTag` (0 success, 1 conflict, 2
 * timeout, 3 db error, 4 identity unresolvable, 5 other).
 *
 * @packageDocumentation
 */

import { exitCodeForTag } from "./exit-code-for-tag.js";
import { injectEnv } from "./internal-inject-env.js";

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
		if (token?.startsWith("--")) {
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

	const label = subcommand ?? "(none)";
	return {
		stdout: "",
		stderr: `${exitCodeForTag("Defect")} Defect: unknown subcommand: ${label}\n`,
		code: exitCodeForTag("Defect"),
	};
};
