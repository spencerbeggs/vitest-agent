import { AgentPlugin } from "@vitest-agent/plugin";

export function setup() {
	AgentPlugin.runScript("pnpm turbo run build:dev");
}
