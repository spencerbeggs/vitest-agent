import { AgentPlugin } from "@vitest-agent/plugin";
import { defineConfig } from "vitest/config";

// Force the silent/stripped-reporter topology regardless of executor so the
// e2e proves the task-tree walk works where onConsoleLog would have been
// gated. "silent" strips Vitest's reporters; task.logs is still populated
// by Vitest's internal console interception. `discoverStrategy: false`
// disables the inject-tags Vite transform — the fixture does not wire
// `AgentPlugin.discover()`, and the transform's injected tags are undeclared
// here, which otherwise drops every test at collection.
export default defineConfig({
	plugins: [AgentPlugin({ discoverStrategy: false, console: { human: "silent", agent: "silent", ci: "silent" } })],
	test: { coverage: { enabled: false } },
});
