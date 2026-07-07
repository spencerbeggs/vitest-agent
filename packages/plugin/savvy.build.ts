import { build } from "@savvy-web/bundler";

await build({
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
