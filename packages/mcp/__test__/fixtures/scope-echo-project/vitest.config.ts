import { AgentPlugin } from "@vitest-agent/plugin";
import { defineConfig } from "vitest/config";

// Isolated fixture for `run-tests-scope-echo.e2e.test.ts`: a NAMED project
// plus two DECLARED tags, so the suite can assert what `RunTestsOk.scope`
// echoes back for project-scoped and tag-scoped runs. The console-leak
// fixture cannot serve this — it declares neither, so both filters would
// only ever produce the `no-match` variant.
//
// `discoverStrategy: false` disables the inject-tags Vite transform (the
// fixture does not wire `AgentPlugin.discover()`); tags are applied
// explicitly per test instead.
export default defineConfig({
	plugins: [AgentPlugin({ discoverStrategy: false, console: { human: "silent", agent: "silent", ci: "silent" } })],
	test: {
		name: "scope-echo",
		coverage: { enabled: false },
		tags: [{ name: "unit" }, { name: "int" }],
	},
});
