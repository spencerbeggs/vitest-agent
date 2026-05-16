import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeLibraryBuilder } from "@savvy-web/rslib-builder";

/**
 * rslib build config for the `vitest-agent-sidecar` parent package.
 *
 * The parent NO LONGER cross-builds the five SEA binaries — that work
 * moved to the per-platform `vitest-agent-sidecar-<platform>` child
 * packages, which each compile their own binary from their own
 * `src/bin.ts` thin runner and declare that binary as their own `bin`.
 * The argv dispatcher itself lives in `vitest-agent-cli`
 * (`lib/sidecar-dispatch.ts`). The parent now only declares the five
 * children as `optionalDependencies` and exposes a programmatic `.`
 * export (`src/index.ts`) that re-exports `dispatch` / `injectEnv`
 * from `vitest-agent-cli`. It carries no `bin` of its own — the
 * matching child package puts the SEA directly on `PATH`, so the hook
 * runs the native binary with no intermediate Node process.
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
