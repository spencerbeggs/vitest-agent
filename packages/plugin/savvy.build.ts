import { build, defaultManifestTransform } from "@savvy-web/bundler";

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
	// `@vitest-agent/cli` and `@vitest-agent/mcp` are declared as regular
	// `dependencies` in source (with `workspace:*`, which changesets reads as
	// their exact current version). A cli/mcp release therefore pushes the
	// plugin's dep out of range and auto-PATCH-bumps the plugin
	// (`updateInternalDependencies: patch`), re-pinning the exact version at
	// publish — a source `peerDependency` on a released workspace package would
	// instead force a MAJOR bump every release and publish an inexact `^` range.
	// Consumers still receive them as peers alongside the rest of the family, so
	// promote them back into `peerDependencies` for the published manifest and
	// drop them from `dependencies` before the default transform runs.
	transform: ({ pkg }) => {
		const deps = pkg.dependencies as Record<string, string> | undefined;
		const peers = (pkg.peerDependencies as Record<string, string> | undefined) ?? {};
		for (const name of ["@vitest-agent/cli", "@vitest-agent/mcp"]) {
			const range = deps?.[name];
			if (range) {
				peers[name] = range;
				delete deps[name];
			}
		}
		pkg.peerDependencies = peers;
		pkg.dependencies = deps;
		return defaultManifestTransform({ pkg });
	},
});
