import { CliColor } from "@effected/cli";
import { CurrentDistribution, distributionSuffix } from "@effected/engine";
import { Effect, Layer } from "effect";

/**
 * The program's one `CliOutput.Formatter` layer: `CliColor.formatterLayer`
 * (the kit's single colour decision — stdout is a TTY and `NO_COLOR` is
 * unset or empty) with only `formatVersion` overridden, so `--version`
 * prints `vitest-agent <cli version>` plus ` via <name> <version>` when a
 * carrier (`@vitest-agent/plugin`'s bin shim) threaded its identity down.
 * Help and parse-error rendering stay `CliColor`'s own.
 *
 * `Layer.unwrap` reads `CurrentDistribution` once, at layer build time, from
 * the ambient context `main.ts` provides — so `main.ts` must provide
 * `CurrentDistribution` OUTSIDE the layer, not inside it.
 *
 * @internal
 */
export const versionFormatterLayer = Layer.unwrap(
	Effect.map(CurrentDistribution, (distribution) =>
		CliColor.formatterLayer({
			formatVersion: (name: string, version: string): string => `${name} ${version}${distributionSuffix(distribution)}`,
		}),
	),
);
