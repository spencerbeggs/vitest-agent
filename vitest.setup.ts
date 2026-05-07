import { AgentPlugin } from "vitest-agent-plugin";

export function setup() {
	AgentPlugin.runScript("pnpm exec turbo run build:dev --log-prefix=none --output-logs=errors-only");
}
