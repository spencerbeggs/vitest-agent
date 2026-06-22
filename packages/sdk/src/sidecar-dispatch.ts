import { exitCodeForTag } from "./exit-code-for-tag.js";
import { injectEnv } from "./internal-inject-env.js";

/** Result of a {@link dispatch} call: captured stdout/stderr + exit code.
 * @public
 */
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
 * @public
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
