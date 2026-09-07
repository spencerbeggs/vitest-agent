import { AgentPlugin } from "@vitest-agent/plugin";
import { defineConfig } from "vitest/config";

// `discoverStrategy: false` disables the inject-tags Vite transform — the
// fixture does not wire `AgentPlugin.discover()`, so injected tags would
// be undeclared and drop every test at collection. The console modes are
// pinned silent so the subprocess's stdout stays empty and the assertion
// reads the written files, never scraped output.
export default defineConfig({
	plugins: [AgentPlugin({ discoverStrategy: false, console: { human: "silent", agent: "silent", ci: "silent" } })],
	test: { coverage: { enabled: false } },
});
