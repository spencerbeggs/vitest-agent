import { defineBuild, runBuild } from "@savvy-web/bundler";

const config = defineBuild({
	bundledPackages: ["@vitest-agent/sdk"],
	meta: {
		localPaths: ["../../website/lib/models/ui"],
		tsdoc: {
			// Effect's Context.Tag / Schema.Class generate synthetic `_base`
			// intermediate classes that cannot be exported or release-tagged
			// from source. This is the toolchain-sanctioned suppression.
			suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
		},
	},
});

export default config;

if (import.meta.main) {
	await runBuild(config, { cwd: import.meta.dirname, argv: process.argv.slice(2) });
}
