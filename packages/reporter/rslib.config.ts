import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeLibraryBuilder } from "@savvy-web/rslib-builder";

// T12 drift wiring: inline package.json#version as a literal so the dist
// carries CURRENT_REPORTER_VERSION for the plugin's drift check.
const PKG_VERSION = JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"))
	.version as string;

// `LiveInkRenderer.tsx` brings JSX into this package. rslib/SWC defaults
// to the classic JSX runtime, emitting bare `React.createElement(...)`
// calls with no `React` namespace binding. The `.tsx` source here is
// written for the automatic runtime (matching this package's tsconfig
// `"jsx": "react-jsx"`) and only imports `react` types. Pin SWC's React
// transform to the automatic runtime so the dist emits `jsx`/`jsxs`
// imports from `react/jsx-runtime` instead — without this the built dist
// re-emits the `React is not defined` bug.
export default NodeLibraryBuilder.create({
	externals: [
		"effect",
		"@effect/platform",
		"@effect/platform-node",
		"@effect/sql",
		"@effect/sql-sqlite-node",
		"react",
		"ink",
		"vitest",
		"vitest/node",
		"vitest-agent-sdk",
		"vitest-agent-ui",
	],
	plugins: [
		{
			name: "reporter-automatic-jsx-runtime",
			setup(api) {
				api.modifyRsbuildConfig((config) => {
					config.tools ??= {};
					config.tools.swc = {
						jsc: {
							transform: {
								react: {
									runtime: "automatic",
								},
							},
						},
					};
					return config;
				});
			},
		},
	],
	define: {
		"process.env.__PACKAGE_VERSION__": JSON.stringify(PKG_VERSION),
	},
	apiModel: {
		suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
	},
	transform({ pkg, target }) {
		if (target?.registry === "https://npm.pkg.github.com/") {
			pkg.name = "@spencerbeggs/vitest-agent-reporter";
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
