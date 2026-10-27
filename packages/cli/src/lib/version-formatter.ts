import type { CliOutput } from "effect/cli";

/**
 * The `CliOutput.Formatter` method `main.ts` replaces through
 * `CliRuntime.main`'s `env.formatter`: only `formatVersion`, so `--version`
 * prints `vitest-agent <cli version>` (core's default formatter writes
 * `<name> v<version>`, and the published output has no `v`).
 *
 * The carrier's ` via <name> <version>` is not added here: `CliRuntime.main`'s
 * `distribution` option wraps whichever `formatVersion` is in effect, this
 * one included, and provides `CurrentDistribution` alongside.
 *
 * `env.formatter` is the kit's one way to keep a formatter method of our own:
 * `main` installs its coloured default formatter inside the platform, which
 * shadows any formatter the platform sets. Every method left out keeps the
 * kit's coloured default, and `helpOnUsageError: "stderr"` still wraps the
 * result, so usage-error help keeps going to stderr.
 *
 * @internal
 */
export const plainVersionFormatter: Pick<CliOutput.Formatter, "formatVersion"> = {
	formatVersion: (name: string, version: string): string => `${name} ${version}`,
};
