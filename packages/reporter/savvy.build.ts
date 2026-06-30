import { build } from "@savvy-web/bundler";

await build({
	bundledPackages: ["@vitest-agent/sdk", "@vitest-agent/ui"],
	meta: {
		localPaths: ["../../website/lib/models/reporter"],
	},
});
