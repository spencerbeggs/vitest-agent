/**
 * Build helper for the vitest-agent-sidecar-<platform> packages.
 *
 * tsdown produces a SEA binary but performs no package.json transform
 * and emits no dist/ variants. This module supplies the missing piece:
 * a `sidecarDist` factory wired as each child's tsdown `onSuccess`
 * handler. `onSuccess` is the only tsdown extension point that runs
 * after the SEA `exe` binary is generated.
 *
 * After the build it renames the exe output to the bare binary name,
 * then writes all three dist/ variants — dist/dev, dist/github,
 * dist/npm — each holding the binary, a publish-cleaned package.json,
 * README.md, and LICENSE.
 *
 * All three variants are always emitted (there is no build mode): the
 * parent vitest-agent-sidecar package is rslib-built, and its
 * build:prod resolves the workspace-protocol optionalDependencies on
 * these children by reading each child's dist/dev/package.json (the
 * linkDirectory base), so dist/dev must always be present. Emitting a
 * fixed set also keeps the build:dev / build:prod scripts free of an
 * environment-variable prefix, which the per-platform CI matrix needs
 * since the win32-x64 child builds on a Windows runner.
 *
 * @packageDocumentation
 */

import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** A published dist variant. */
export type SidecarDistVariant = "dev" | "github" | "npm";

/** package.json fields kept in a published sidecar sub-package. */
const KEPT_FIELDS = [
	"name",
	"version",
	"description",
	"keywords",
	"homepage",
	"bugs",
	"repository",
	"license",
	"author",
	"type",
	"bin",
	"files",
	"os",
	"cpu",
] as const;

/**
 * Produce the package.json written into a `dist/` variant from the
 * source manifest. Drops build-only fields (devDependencies, scripts,
 * publishConfig, packageManager, devEngines), sets `private` to false,
 * and — for the `github` variant only — scopes the name to
 * `@spencerbeggs/`.
 */
export const transformManifest = (
	manifest: Record<string, unknown>,
	variant: SidecarDistVariant,
): Record<string, unknown> => {
	const out: Record<string, unknown> = {};
	for (const key of KEPT_FIELDS) {
		if (manifest[key] !== undefined) out[key] = manifest[key];
	}
	out.private = false;
	if (variant === "github" && typeof out.name === "string") {
		out.name = `@spencerbeggs/${out.name}`;
	}
	return out;
};

/** Options for {@link sidecarDist}. */
export interface SidecarDistOptions {
	/** tsdown platform token: "darwin", "linux", or "win". */
	readonly platform: string;
	/** tsdown arch token: "arm64" or "x64". */
	readonly arch: string;
}

/** Every build emits all three variants — see the module header. */
const DIST_VARIANTS: readonly SidecarDistVariant[] = ["dev", "github", "npm"];

/**
 * Build the tsdown `onSuccess` handler for a sidecar sub-package. The
 * handler renames the SEA binary and writes the three dist/ variants.
 */
export const sidecarDist =
	(opts: SidecarDistOptions): (() => Promise<void>) =>
	async (): Promise<void> => {
		const cwd = process.cwd();
		const isWindows = opts.platform === "win";
		const binaryName = isWindows ? "vitest-agent-sidecar.exe" : "vitest-agent-sidecar";

		// 1. tsdown appends -<platform>-<arch> to the SEA file name when
		//    `targets` is set; rename it to the bare published name.
		const builtName = `vitest-agent-sidecar-${opts.platform}-${opts.arch}${isWindows ? ".exe" : ""}`;
		const finalBinary = join(cwd, "bin", binaryName);
		await rename(join(cwd, "bin", builtName), finalBinary);

		// 2. Emit the three dist variants.
		const manifest = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as Record<string, unknown>;

		for (const variant of DIST_VARIANTS) {
			const dir = join(cwd, "dist", variant);
			await mkdir(join(dir, "bin"), { recursive: true });
			await copyFile(finalBinary, join(dir, "bin", binaryName));
			await writeFile(join(dir, "package.json"), `${JSON.stringify(transformManifest(manifest, variant), null, 2)}\n`);
			for (const file of ["README.md", "LICENSE"]) {
				await copyFile(join(cwd, file), join(dir, file));
			}
		}
	};
