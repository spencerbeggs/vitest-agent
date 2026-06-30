import { build } from "@savvy-web/bundler";

await build({
	meta: {
		localPaths: ["../../website/lib/models/sdk"],
		tsdoc: {
			// Effect's Data.TaggedError / Effect.Service / Schema.Class generate synthetic
			// `_base` intermediate classes that cannot be exported or release-tagged from
			// source. This is the toolchain-sanctioned suppression for this pattern.
			suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
		},
	},
});
