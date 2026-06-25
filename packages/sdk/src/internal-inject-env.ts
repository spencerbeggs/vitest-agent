import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectVitestScripts, rewriteBashCommand } from "./utils/match-vitest-command.js";

/** Input to {@link injectEnv}. @public */
export interface InjectEnvInput {
	readonly command: string;
	readonly cwd: string;
	readonly env: Record<string, string | undefined>;
}

const readPackageScripts = (cwd: string): Record<string, string> => {
	try {
		const raw = readFileSync(join(cwd, "package.json"), "utf-8");
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
 * Always synchronous — the package.json read is the only I/O and is
 * fast enough not to need Effect wrapping.
 * @public
 */
export const injectEnv = (input: InjectEnvInput): string => {
	const conversationId = input.env.VITEST_AGENT_CONVERSATION_ID;
	const agentId = input.env.VITEST_AGENT_AGENT_ID;
	if (conversationId === undefined || agentId === undefined) return input.command;

	const scripts = readPackageScripts(input.cwd);
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
