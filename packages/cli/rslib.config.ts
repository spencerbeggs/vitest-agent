import { NodeLibraryBuilder } from "@savvy-web/rslib-builder";

export default NodeLibraryBuilder.create({
	externals: [
		"effect",
		"@effect/cli",
		"@effect/platform",
		"@effect/platform-node",
		"@effect/sql",
		"@effect/sql-sqlite-node",
		"vitest-agent-sdk",
		"vitest-agent-sidecar",
	],
	apiModel: {
		localPaths: ["../../website/lib/models/cli"],
		suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
	},
	transform({ pkg, target }) {
		if (target?.registry === "https://npm.pkg.github.com/") {
			pkg.name = "@spencerbeggs/vitest-agent-cli";
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
