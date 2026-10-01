import type { Distribution } from "@effected/engine";
import { distributionSuffix } from "@effected/engine";
import type { Option } from "effect";
import type { CliOutput } from "effect/cli";

/**
 * The `CliOutput.Formatter` methods `main.ts` replaces through
 * `CliRuntime.main`'s `env.formatter`: only `formatVersion`, so `--version`
 * prints `vitest-agent <cli version>` plus ` via <name> <version>` when a
 * carrier (`@vitest-agent/plugin`'s bin shim) passed its identity to `main`.
 *
 * `env.formatter` is the kit's one way to keep a formatter method of our own:
 * `main` installs its coloured default formatter inside the platform, which
 * shadows any formatter the platform sets. Every method left out keeps the
 * kit's coloured default, and `helpOnUsageError: "stderr"` still wraps the
 * result, so usage-error help keeps going to stderr.
 *
 * `distribution` is the same value `main.ts` provides as `CurrentDistribution`;
 * it is known when `main` is called, so it is read here directly rather than
 * from the context when `--version` runs.
 *
 * @internal
 */
export const carrierVersionFormatter = (
	distribution: Option.Option<Distribution>,
): Pick<CliOutput.Formatter, "formatVersion"> => {
	const suffix = distributionSuffix(distribution);
	return { formatVersion: (name: string, version: string): string => `${name} ${version}${suffix}` };
};
