/**
 * Programmatic tsdown SEA build for a vitest-agent-sidecar-<platform>
 * child package.
 *
 * One script, two modes — selected by the npm lifecycle event that ran
 * it (process.env.npm_lifecycle_event):
 *
 *   build:dev   -> emit dist/dev
 *   build:prod  -> emit dist/npm and dist/github
 *
 * Splitting the emitted directories per task gives turbo a disjoint
 * output set per build task, so each task caches independently.
 * dist/dev is the linkDirectory base the parent package links locally;
 * dist/npm and dist/github are the publish targets.
 *
 * Each emitted variant directory holds the SEA binary, a transformed
 * package.json (see transformManifest), README.md and LICENSE.
 *
 * The intermediate JS bundle and SEA scratch live under a per-mode
 * dist/.bundle/<mode> directory and are deleted once the variants are
 * written, so turbo only ever caches the final dist/<variant> outputs.
 *
 * The script is identical across all four children: the platform and
 * arch are derived from the package's own os/cpu fields, so it can be
 * copied verbatim from one child to the next.
 */

import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "tsdown";

/** Node runtime version embedded in the SEA. */
const NODE_VERSION = "25.9.0";

/**
 * Produce the package.json written into a dist/<variant> directory.
 *
 * For every variant: drop the build-only `scripts`, `devDependencies`
 * and `publishConfig` fields. A sidecar child has zero runtime
 * dependencies — the cli/sdk it bundles into the SEA are build-only —
 * so removing `devDependencies` also removes its `workspace:` refs and
 * leaves nothing to resolve at publish time.
 *
 * For the npm and github publish variants: clear `private`. For github
 * only: scope the name to `@spencerbeggs/` for the GitHub Packages
 * registry.
 */
const transformManifest = (source: string, variant: string): string => {
	const manifest = JSON.parse(source) as Record<string, unknown>;
	delete manifest.scripts;
	delete manifest.devDependencies;
	delete manifest.publishConfig;
	if (variant !== "dev") {
		manifest.private = false;
		if (variant === "github") {
			manifest.name = `@spencerbeggs/${manifest.name as string}`;
		}
	}
	return `${JSON.stringify(manifest, null, "\t")}\n`;
};

// turbo runs this through the package manager with the cwd set to the
// package root, so process.cwd() is the child package directory.
const root = process.cwd();

const manifestSource = await readFile(join(root, "package.json"), "utf8");
const { os, cpu } = JSON.parse(manifestSource) as { os: string[]; cpu: string[] };

const osToken = os[0];
const cpuToken = cpu[0];
if (osToken !== "darwin" && osToken !== "linux" && osToken !== "win32") {
	throw new Error(`vitest-agent-sidecar build: unsupported os "${osToken}"`);
}
if (cpuToken !== "arm64" && cpuToken !== "x64") {
	throw new Error(`vitest-agent-sidecar build: unsupported cpu "${cpuToken}"`);
}
// tsdown's exe `targets` want literal ExePlatform / ExeArch tokens, not
// a widened `string` — narrowing os/cpu to their unions supplies that.
const platform = osToken === "win32" ? "win" : osToken;
const arch = cpuToken;
const isWindows = platform === "win";
const binaryName = isWindows ? "vitest-agent-sidecar.exe" : "vitest-agent-sidecar";

const mode = process.env.npm_lifecycle_event === "build:dev" ? "dev" : "prod";
const variants = mode === "dev" ? ["dev"] : ["npm", "github"];

// Per-mode scratch directory: build:dev and build:prod never share an
// intermediate path, so neither can clobber the other's cache.
const scratch = join("dist", ".bundle", mode);

// 1. Build the SEA binary once. tsdown bundles src/bin.ts (and the
//    vitest-agent-cli graph it imports) into a single file, then the
//    @tsdown/exe `exe` stage wraps that into a Node SEA executable.
await build({
	entry: ["src/bin.ts"],
	format: "esm",
	platform: "node",
	outDir: scratch,
	clean: true,
	// A SEA binary is a single self-contained file: every non-builtin
	// import must be bundled, since none are resolvable from disk at
	// runtime inside the SEA.
	deps: {
		alwaysBundle: (id: string) => !id.startsWith("node:"),
	},
	exe: {
		fileName: "vitest-agent-sidecar",
		outDir: join(scratch, "bin"),
		seaConfig: {
			disableExperimentalSEAWarning: true,
			// Both MUST stay false for a target build.
			useCodeCache: false,
			useSnapshot: false,
		},
		targets: [{ platform, arch, nodeVersion: NODE_VERSION }],
	},
});

// tsdown appends -<platform>-<arch> to the exe name when `targets` is set.
const builtBinary = join(root, scratch, "bin", `vitest-agent-sidecar-${platform}-${arch}${isWindows ? ".exe" : ""}`);

// 2. Emit each dist/ variant directory for the active mode.
for (const variant of variants) {
	const dir = join(root, "dist", variant);
	await rm(dir, { recursive: true, force: true });
	await mkdir(join(dir, "bin"), { recursive: true });
	await copyFile(builtBinary, join(dir, "bin", binaryName));
	await writeFile(join(dir, "package.json"), transformManifest(manifestSource, variant));
	for (const file of ["README.md", "LICENSE"]) {
		await copyFile(join(root, file), join(dir, file));
	}
}

// 3. Drop the intermediate scratch so turbo caches only dist/<variant>.
await rm(join(root, scratch), { recursive: true, force: true });

console.log(`vitest-agent-sidecar-${platform}-${arch}: emitted dist/{${variants.join(",")}}`);
