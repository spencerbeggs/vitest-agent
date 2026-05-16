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
 * then writes dist/dev (mode "dev") or dist/github + dist/npm (mode
 * "prod"), each holding the binary, a publish-cleaned package.json,
 * README.md, and LICENSE.
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

/** Variants emitted per SIDECAR_DIST_MODE value. */
const VARIANTS_BY_MODE: Record<string, readonly SidecarDistVariant[]> = {
	dev: ["dev"],
	prod: ["github", "npm"],
};

/**
 * Build the tsdown `onSuccess` handler for a sidecar sub-package.
 *
 * Reads `SIDECAR_DIST_MODE` from the environment ("dev" or "prod",
 * defaulting to "prod"). The npm `build:dev` / `build:prod` scripts set
 * it.
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

		// 2. Emit the dist variant(s) for the active build mode.
		const mode = process.env.SIDECAR_DIST_MODE ?? "prod";
		const variants = VARIANTS_BY_MODE[mode] ?? VARIANTS_BY_MODE.prod;
		const manifest = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as Record<string, unknown>;

		for (const variant of variants) {
			const dir = join(cwd, "dist", variant);
			await mkdir(join(dir, "bin"), { recursive: true });
			await copyFile(finalBinary, join(dir, "bin", binaryName));
			await writeFile(join(dir, "package.json"), `${JSON.stringify(transformManifest(manifest, variant), null, 2)}\n`);
			for (const file of ["README.md", "LICENSE"]) {
				await copyFile(join(cwd, file), join(dir, file));
			}
		}
	};
