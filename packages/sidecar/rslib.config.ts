import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeLibraryBuilder } from "@savvy-web/rslib-builder";

/**
 * rslib build config for the `vitest-agent-sidecar` parent package.
 *
 * The parent NO LONGER cross-builds the five SEA binaries — that work
 * moved to the per-platform `vitest-agent-sidecar-<platform>` child
 * packages, which each compile their own binary from this package's
 * shared `src/bin.ts`. The parent now only:
 *
 *   1. ships the `bin/launcher.js` runtime resolver shim, and
 *   2. exposes the shared dispatcher source (`src/bin.ts`) as the
 *      package's `.` export so it builds the plain JS dev/npm bundle.
 *
 * It is built with rslib-builder (like the six lockstep packages) for
 * one decisive reason: rslib-builder emits a transformed
 * `dist/dev/package.json` with `workspace:*` / `catalog:` references
 * resolved. `publishConfig.linkDirectory: true` makes pnpm symlink
 * `node_modules/vitest-agent-sidecar` at the publish directory
 * (`dist/dev`), so a consumer that declares this package as a
 * `workspace:*` dependency (notably `vitest-agent-plugin`) needs a
 * real `package.json` to exist there. tsdown does not emit one — its
 * absence was the `Workspace resolution failed` failure in
 * `vitest-agent-plugin#build:prod`.
 *
 * `bin/launcher.js` is a hand-written CommonJS file, not a TS entry:
 * rslib-builder leaves a non-`.ts` `bin` value untouched and never
 * compiles it. `copyPatterns` ships it verbatim into the dist.
 */

// T12 drift wiring: inline package.json#version as a literal so the
// dist carries the package version for the cross-package drift check.
const PKG_VERSION = JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"))
	.version as string;

export default NodeLibraryBuilder.create({
	externals: [
		"effect",
		"@effect/platform",
		"@effect/platform-node",
		"@effect/sql",
		"@effect/sql-sqlite-node",
		"vitest-agent-cli",
		"vitest-agent-sdk",
	],
	define: {
		"process.env.__PACKAGE_VERSION__": JSON.stringify(PKG_VERSION),
	},
	// The CommonJS launcher shim is shipped as-is — it resolves the
	// matching platform child package at runtime and execs its binary.
	copyPatterns: [{ from: "bin/launcher.js", to: "bin/launcher.js" }],
	apiModel: {
		suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
	},
	transform({ pkg, target }) {
		if (target?.registry === "https://npm.pkg.github.com/") {
			pkg.name = "@spencerbeggs/vitest-agent-sidecar";
		}
		delete pkg.devDependencies;
		delete pkg.bundleDependencies;
		delete pkg.scripts;
		delete pkg.publishConfig;
		delete pkg.packageManager;
		delete pkg.devEngines;
		return pkg;
	},
});
