import { build } from "@savvy-web/bundler";

await build({
	meta: {
		localPaths: ["../../website/lib/models/mcp"],
		tsdoc: {
			// Effect's Context.Service generates a synthetic `_base` intermediate
			// class that cannot be exported or release-tagged from source. This is
			// the toolchain-sanctioned suppression for this pattern.
			suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
		},
	},
});
