import { defineConfig } from "vitest/config";
import { injectTags } from "../../../src/utils/inject-tags.js";

// Minimal harness for the file-level tag prelude: every *.test.ts file in
// this fixture gets the "unit" classification tag injected, exactly like
// AgentPlugin's transform hook does, but without the plugin's reporter and
// persistence machinery.
export default defineConfig({
	plugins: [
		{
			name: "tag-prelude-fixture",
			transform(code, id) {
				const cleanId = id.split("?")[0] ?? id;
				if (!cleanId.endsWith(".test.ts")) return null;
				return injectTags(code, ["unit"]);
			},
		},
	],
	test: {
		include: ["*.test.ts"],
		tags: [{ name: "unit" }, { name: "custom" }],
	},
});
