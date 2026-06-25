import { defineBuild, runBuild } from "@savvy-web/bundler";

const config = defineBuild({
	bundledPackages: ["@vitest-agent/sdk", "@vitest-agent/ui"],
	meta: {
		localPaths: ["../../website/lib/models/reporter"],
	},
});

export default config;

if (import.meta.main) {
	await runBuild(config, { cwd: import.meta.dirname, argv: process.argv.slice(2) });
}
