import { detectVitestScripts, rewriteBashCommand } from "./utils/match-vitest-command.js";

/** Input to {@link injectEnv}. @public */
export interface InjectEnvInput {
	readonly command: string;
	readonly cwd: string;
	readonly env: Record<string, string | undefined>;
	/**
	 * Synchronous file reader, injected so the core never touches
	 * `node:fs`. Throws on a missing file; {@link injectEnv} catches.
	 */
	readonly readFile: (path: string) => string;
}

const readPackageScripts = (cwd: string, readFile: (path: string) => string): Record<string, string> => {
	try {
		const raw = readFile(`${cwd}/package.json`);
		const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
		return parsed.scripts ?? {};
	} catch {
		// Missing or malformed package.json — no scripts to detect; the
		// other four pattern shapes still match.
		return {};
	}
};

/**
 * Compute the (possibly rewritten) Bash command. Returns the original
 * unchanged when:
 *
 *   - The command does not match any Vitest pattern
 *   - `VITEST_AGENT_CONVERSATION_ID` or `VITEST_AGENT_AGENT_ID` is
 *     missing from env (no agent context to attribute to)
 *
 * Always synchronous — the package.json read is the only I/O, goes through
 * the injected `readFile`, and is fast enough not to need Effect wrapping.
 * @public
 */
export const injectEnv = (input: InjectEnvInput): string => {
	const conversationId = input.env.VITEST_AGENT_CONVERSATION_ID;
	const agentId = input.env.VITEST_AGENT_AGENT_ID;
	if (conversationId === undefined || agentId === undefined) return input.command;

	const scripts = readPackageScripts(input.cwd, input.readFile);
	const vitestScripts = detectVitestScripts(scripts);

	const parentAgentId = input.env.VITEST_AGENT_PARENT_AGENT_ID;
	return rewriteBashCommand({
		command: input.command,
		vitestScripts,
		conversationId,
		agentId,
		...(parentAgentId !== undefined && { parentAgentId }),
	});
};
