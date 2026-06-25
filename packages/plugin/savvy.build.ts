import { defineBuild, runBuild } from "@savvy-web/bundler";

const config = defineBuild({
	dtsExternals: ["@vitest/runner"],
	meta: {
		localPaths: ["../../website/lib/models/plugin"],
		tsdoc: {
			// Effect's Context.Tag generates synthetic `_base` intermediate classes
			// that cannot be exported or release-tagged from source. This is the
			// toolchain-sanctioned suppression for this pattern.
			suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
		},
	},
});

export default config;

if (import.meta.main) {
	await runBuild(config, { cwd: import.meta.dirname, argv: process.argv.slice(2) });
}
