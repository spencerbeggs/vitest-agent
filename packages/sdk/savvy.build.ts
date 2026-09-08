import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
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

/*
 * The published JSON Schema documents under `schemas/` are generated assets,
 * not source modules, so the bundler's exports graph never sees them. Copy
 * them into every emitted package directory so `run.json`'s `$schema` URL has
 * an offline counterpart inside the installed package.
 */
const publishedSchemasDir = join(import.meta.dirname, "schemas");
const packageDirs = [
	join(import.meta.dirname, "dist", "dev", "pkg"),
	...(existsSync(join(import.meta.dirname, "dist", "prod"))
		? readdirSync(join(import.meta.dirname, "dist", "prod"), { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => join(import.meta.dirname, "dist", "prod", entry.name, "pkg"))
		: []),
];

for (const packageDir of packageDirs) {
	if (!existsSync(packageDir)) continue;
	const target = join(packageDir, "schemas");
	mkdirSync(target, { recursive: true });
	for (const file of readdirSync(publishedSchemasDir)) {
		if (file.endsWith(".json")) copyFileSync(join(publishedSchemasDir, file), join(target, file));
	}
}
