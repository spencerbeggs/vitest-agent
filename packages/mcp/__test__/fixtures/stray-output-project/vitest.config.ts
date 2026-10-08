import { AgentPlugin } from "@vitest-agent/plugin";
import { defineConfig } from "vitest/config";

// The plugin owns the console in every slot ("silent"), so it captures what
// workers write past Vitest's console capture. `discoverStrategy: false`:
// this fixture does not wire `AgentPlugin.discover()`.
export default defineConfig({
	plugins: [AgentPlugin({ discoverStrategy: false, console: { human: "silent", agent: "silent", ci: "silent" } })],
	test: { pool: "forks", coverage: { enabled: false } },
});
