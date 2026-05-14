import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeLibraryBuilder } from "@savvy-web/rslib-builder";

// Read the source package.json#version once at config-load time so the
// define block below inlines the literal version string into the build.
// This is the cross-package drift wiring (T12) — every runtime package's
// dist carries CURRENT_<PKG>_VERSION as a literal, and the plugin / MCP /
// CLI init checks compare them at runtime.
const PKG_VERSION = JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"))
	.version as string;

export default NodeLibraryBuilder.create({
	externals: ["effect", "@effect/platform", "@effect/platform-node", "@effect/sql", "@effect/sql-sqlite-node"],
	define: {
		"process.env.__PACKAGE_VERSION__": JSON.stringify(PKG_VERSION),
	},
	apiModel: {
		suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
	},
	transform({ pkg, target }) {
		if (target?.registry === "https://npm.pkg.github.com/") {
			pkg.name = "@spencerbeggs/vitest-agent-sdk";
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
