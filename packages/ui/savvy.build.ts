// import { NodeLibraryBuilder } from "@savvy-web/rslib-builder";

// // rslib/SWC defaults to the classic JSX runtime, emitting bare
// // `React.createElement(...)` calls with no `React` namespace binding. The
// // `.tsx` sources here are written for the automatic runtime (matching this
// // package's tsconfig `"jsx": "react-jsx"`), so they only import `react`
// // types. Pin SWC's React transform to the automatic runtime so the dist
// // emits `jsx`/`jsxs` imports from `react/jsx-runtime` instead.
// export default NodeLibraryBuilder.create({
// 	externals: ["effect", "react", "ink", "vitest-agent-sdk"],
// 	plugins: [
// 		{
// 			name: "ui-automatic-jsx-runtime",
// 			setup(api) {
// 				api.modifyRsbuildConfig((config) => {
// 					config.tools ??= {};
// 					config.tools.swc = {
// 						jsc: {
// 							transform: {
// 								react: {
// 									runtime: "automatic",
// 								},
// 							},
// 						},
// 					};
// 					return config;
// 				});
// 			},
// 		},
// 	],
// 	apiModel: {
// 		localPaths: ["../../website/lib/models/ui"],
// 		suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
// 	},
// 	transform({ pkg, target }) {
// 		if (target?.registry === "https://npm.pkg.github.com/") {
// 			pkg.name = "@spencerbeggs/vitest-agent-ui";
// 		}
// 		delete pkg.devDependencies;
// 		delete pkg.bundleDependencies;
// 		delete pkg.scripts;
// 		delete pkg.publishConfig;
// 		delete pkg.packageManager;
// 		delete pkg.devEngines;
// 		return pkg;
// 	},
// });

import { defineBuild, runBuild } from "@savvy-web/bundler";

const config = defineBuild({
	meta: {
		localPaths: ["../../website/lib/models/ui"],
	},
});

export default config;

if (import.meta.main) {
	await runBuild(config, { cwd: import.meta.dirname, argv: process.argv.slice(2) });
}
