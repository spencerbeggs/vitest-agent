import { defineBuild, runBuild } from "@savvy-web/bundler";

// The `vitest-agent-sidecar` parent package does NOT cross-build the four SEA
// binaries — that work lives in the per-platform `vitest-agent-sidecar-<platform>`
// child packages, which each compile their own binary from their own thin
// `src/bin.ts` runner and declare it as their own `bin`. The parent carries no
// `bin` of its own; it only declares the four children as `optionalDependencies`
// and exposes a programmatic `.` export (`src/index.ts`) re-exporting the pure
// `resolveSidecarBinaryPath` helper. The matching child puts the SEA directly on
// PATH, so the hook runs the native binary with no intermediate Node process.
const config = defineBuild({
	meta: {
		localPaths: ["../../website/lib/models/sidecar"],
	},
});

export default config;

if (import.meta.main) {
	await runBuild(config, { cwd: import.meta.dirname, argv: process.argv.slice(2) });
}
