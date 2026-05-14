import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeLibraryBuilder } from "@savvy-web/rslib-builder";

// T12 drift wiring: inline package.json#version as a literal so the dist
// carries CURRENT_UI_VERSION; the plugin reads this in its drift check.
const PKG_VERSION = JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"))
	.version as string;

export default NodeLibraryBuilder.create({
	externals: ["effect", "react", "ink", "vitest-agent-sdk"],
	define: {
		"process.env.__PACKAGE_VERSION__": JSON.stringify(PKG_VERSION),
	},
	apiModel: {
		suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
	},
	transform({ pkg, target }) {
		if (target?.registry === "https://npm.pkg.github.com/") {
			pkg.name = "@spencerbeggs/vitest-agent-ui";
		}
		delete pkg.devDependencies;
		delete pkg.bundleDependencies;
		delete pkg.scripts;
		delete pkg.publishConfig;
		delete pkg.packageManager;
		delete pkg.devEngines;
		return pkg;
	},
});
