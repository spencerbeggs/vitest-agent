import { build } from "@savvy-web/bundler";

await build({
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
