import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeLibraryBuilder } from "@savvy-web/rslib-builder";

// T12 drift wiring: inline package.json#version as a literal so the dist
// carries CURRENT_PLUGIN_VERSION for the cross-package init-time check.
const PKG_VERSION = JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"))
	.version as string;

export default NodeLibraryBuilder.create({
	externals: [
		"effect",
		"@effect/platform",
		"@effect/platform-node",
		"@effect/sql",
		"@effect/sql-sqlite-node",
		"vitest",
		"vitest/node",
		"vitest-agent-sdk",
		"vitest-agent-reporter",
	],
	define: {
		"process.env.__PACKAGE_VERSION__": JSON.stringify(PKG_VERSION),
	},
	apiModel: {
		suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
	},
	transform({ pkg, target }) {
		if (target?.registry === "https://npm.pkg.github.com/") {
			pkg.name = "@spencerbeggs/vitest-agent-plugin";
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
