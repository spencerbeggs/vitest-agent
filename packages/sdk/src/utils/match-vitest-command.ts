const RE_DIRECT = /^\s*vitest(\s|$)/;
const RE_RUNNER = /^\s*(npx|pnpx|bunx)\s+vitest(\s|$)/;
const RE_PM_EXEC = /^\s*(npm|pnpm|yarn|bun)\s+(exec|dlx|x)\s+vitest(\s|$)/;
const RE_NODE_BIN = /^\s*node\s+(\.\/)?node_modules\/\.bin\/vitest(\s|$)/;

const matchPmScript = (command: string, scripts: ReadonlySet<string>): boolean => {
	if (scripts.size === 0) return false;
	const trimmed = command.trimStart();
	for (const scriptName of scripts) {
		const escaped = scriptName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const re = new RegExp(`^(npm|pnpm|yarn|bun)\\s+(run\\s+)?${escaped}(\\s|$)`);
		if (re.test(trimmed)) return true;
	}
	return false;
};

/**
 * Return `true` if the command invokes Vitest in any of the five
 * supported shapes. The `vitestScripts` set carries the names of
 * package.json scripts that were detected as containing `vitest`
 * (computed once per project and cached by the sidecar).
 * @public
 */
export const isVitestInvocation = (command: string, vitestScripts: ReadonlySet<string>): boolean => {
	if (RE_DIRECT.test(command)) return true;
	if (RE_RUNNER.test(command)) return true;
	if (RE_PM_EXEC.test(command)) return true;
	if (RE_NODE_BIN.test(command)) return true;
	if (matchPmScript(command, vitestScripts)) return true;
	return false;
};

/**
 * Build the env-var prefix string to prepend to a matched command.
 *
 * Returns the assignments in the documented order:
 *   `VITEST_AGENT_CONVERSATION_ID=<uuid> VITEST_AGENT_AGENT_ID=<uuid> [VITEST_AGENT_PARENT_AGENT_ID=<uuid>]`
 *
 * POSIX env-prefix syntax scopes the assignments to the
 * immediately-following process — no sticky-env across subsequent
 * Bash calls, no risk of cross-contamination.
 * @public
 */
export const buildEnvPrefix = (input: {
	readonly conversationId: string;
	readonly agentId: string;
	readonly parentAgentId?: string;
}): string => {
	const parts: string[] = [];
	parts.push(`VITEST_AGENT_CONVERSATION_ID=${input.conversationId}`);
	parts.push(`VITEST_AGENT_AGENT_ID=${input.agentId}`);
	if (input.parentAgentId !== undefined) {
		parts.push(`VITEST_AGENT_PARENT_AGENT_ID=${input.parentAgentId}`);
	}
	return parts.join(" ");
};

/**
 * Compute the rewritten command for a Bash tool invocation. When the
 * command does not match a Vitest shape, returns the original
 * unchanged. When it matches, prepends the env prefix.
 * @public
 */
export const rewriteBashCommand = (input: {
	readonly command: string;
	readonly vitestScripts: ReadonlySet<string>;
	readonly conversationId: string;
	readonly agentId: string;
	readonly parentAgentId?: string;
}): string => {
	if (!isVitestInvocation(input.command, input.vitestScripts)) {
		return input.command;
	}
	const prefix = buildEnvPrefix({
		conversationId: input.conversationId,
		agentId: input.agentId,
		...(input.parentAgentId !== undefined && { parentAgentId: input.parentAgentId }),
	});
	return `${prefix} ${input.command}`;
};

/**
 * Detect which package.json scripts invoke Vitest by inspecting the
 * `scripts` field. Resolves one hop of script reference (e.g.,
 * `"test": "pnpm test:unit && pnpm test:int"` finds vitest if either
 * `test:unit` or `test:int` mentions vitest). Multi-hop indirection
 * is a documented limitation.
 * @public
 */
export const detectVitestScripts = (scripts: Record<string, string>): Set<string> => {
	const directHits = new Set<string>();
	for (const [name, body] of Object.entries(scripts)) {
		if (/\bvitest\b/.test(body)) directHits.add(name);
	}
	// One-hop indirection: a script that runs another script which is
	// itself a vitest hit also counts.
	const includesScriptRef = (body: string, scriptName: string): boolean => {
		const escaped = scriptName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const re = new RegExp(`(npm|pnpm|yarn|bun)\\s+(run\\s+)?${escaped}(\\s|$|&)`);
		return re.test(body);
	};
	for (const [name, body] of Object.entries(scripts)) {
		if (directHits.has(name)) continue;
		for (const hit of directHits) {
			if (includesScriptRef(body, hit)) {
				directHits.add(name);
				break;
			}
		}
	}
	return directHits;
};
