import { build, defaultManifestTransform } from "@savvy-web/bundler";

await build({
	meta: false,
	exe: { fileName: "vitest-agent-sidecar" },
	transform: ({ pkg }) => {
		delete pkg.dependencies;
		return defaultManifestTransform({ pkg });
	},
});
