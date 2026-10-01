import { CurrentDistribution, distributionSuffix } from "@effected/engine";
import { Effect } from "effect";
import { CliOutput } from "effect/cli";

/**
 * Overrides only `formatVersion` on the ambient `CliOutput.Formatter`, so
 * `--version` prints `vitest-agent <cli version>` plus ` via <name> <version>`
 * when a carrier (`@vitest-agent/plugin`'s bin shim) threaded its identity
 * down through `CurrentDistribution`.
 *
 * A program wrapper rather than a `CliColor.formatterLayer({ formatVersion })`
 * on the platform: with `CliRuntime.main`'s `env` option the kit provides its
 * own `CliColor.formatterLayer()` INSIDE the platform, which shadows any
 * formatter the platform sets. The ambient formatter this wrapper reads is the
 * kit's (colour decided by `@effected/env`'s `TerminalEnv`), already wrapped by
 * `helpOnUsageError: "stderr"`'s recording formatter, so the override is layered
 * on it with `Object.create` rather than a spread: the recording formatter's
 * methods live on its prototype chain and a spread would drop them, losing the
 * help-to-stderr routing.
 *
 * `CurrentDistribution` is read when the program runs, from the ambient context
 * `main.ts` provides outermost.
 *
 * @internal
 */
export const withCarrierVersion = <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
	Effect.gen(function* () {
		const formatter = yield* CliOutput.Formatter;
		const suffix = distributionSuffix(yield* CurrentDistribution);
		const overridden: CliOutput.Formatter = Object.assign(Object.create(formatter) as CliOutput.Formatter, {
			formatVersion: (name: string, version: string): string => `${name} ${version}${suffix}`,
		});
		return yield* Effect.provideService(self, CliOutput.Formatter, overridden);
	});
