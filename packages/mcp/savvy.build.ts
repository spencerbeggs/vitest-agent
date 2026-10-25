import { build } from "@savvy-web/bundler";

await build({
	meta: {
		localPaths: ["../../website/lib/models/mcp"],
		tsdoc: {
			// Effect's Context.Service generates a synthetic `_base` intermediate
			// class that cannot be exported or release-tagged from source. This is
			// the toolchain-sanctioned suppression for this pattern.
			// TEMPORARY: @savvy-web/tsdown-plugins 2.11.0 emits `toolHandlers` as
			// `typeof handleX` references instead of inlined signatures, so every
			// tool handler surfaces as a forgotten export. Drop once
			// savvy-web/systems#824 is fixed upstream.
			suppressWarnings: [
				{ messageId: "ae-forgotten-export", pattern: "_base" },
				{ messageId: "ae-forgotten-export", pattern: "handle[A-Z]" },
			],
		},
	},
});
