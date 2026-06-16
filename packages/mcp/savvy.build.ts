// import { NodeLibraryBuilder } from "@savvy-web/rslib-builder";

// export default NodeLibraryBuilder.create({
// 	externals: [
// 		"effect",
// 		"@effect/platform",
// 		"@effect/platform-node",
// 		"@effect/sql",
// 		"@effect/sql-sqlite-node",
// 		"@modelcontextprotocol/sdk",
// 		"@trpc/server",
// 		"vitest",
// 		"vitest/node",
// 		"vitest-agent-sdk",
// 	],
// 	copyPatterns: [
// 		{ from: "src/vendor", to: "vendor" },
// 		{ from: "src/patterns", to: "patterns" },
// 	],
// 	apiModel: {
// 		localPaths: ["../../website/lib/models/mcp"],
// 		suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
// 	},
// 	transform({ pkg, target }) {
// 		if (target?.registry === "https://npm.pkg.github.com/") {
// 			pkg.name = "@spencerbeggs/vitest-agent-mcp";
// 		}
// 		delete pkg.devDependencies;
// 		delete pkg.bundleDependencies;
// 		delete pkg.scripts;
// 		delete pkg.publishConfig;
// 		delete pkg.packageManager;
// 		delete pkg.devEngines;
// 		return pkg;
// 	},
// });

import { defineBuild, runBuild } from "@savvy-web/bundler";

const config = defineBuild({
	meta: {
		localPaths: ["../../website/lib/models/mcp"],
	},
});

export default config;

if (import.meta.main) {
	await runBuild(config, { cwd: import.meta.dirname, argv: process.argv.slice(2) });
}
