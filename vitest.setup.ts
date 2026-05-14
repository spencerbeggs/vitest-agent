import { AgentPlugin } from "vitest-agent-plugin";

export function setup() {
	AgentPlugin.runScript("CI=true pnpm exec turbo run build:dev");
}
