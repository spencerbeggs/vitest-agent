import { AgentPlugin } from "@vitest-agent/plugin";

export function setup() {
	// Workspace links resolve to source, so only the packages whose tests read their own `dist` build here.
	AgentPlugin.runScript(
		"pnpm exec turbo run build --filter=@vitest-agent/cli --filter=@vitest-agent/mcp --filter=@vitest-agent/plugin --output-logs=errors-only",
	);
}
