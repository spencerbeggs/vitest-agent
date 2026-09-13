import type { Environment } from "@vitest-agent/sdk";
import type { Effect } from "effect";
import { Context } from "effect";
/** @public */
export class EnvironmentDetector extends Context.Service<
	EnvironmentDetector,
	{
		readonly detect: () => Effect.Effect<Environment>;
		readonly isAgent: Effect.Effect<boolean>;
		readonly agentName: Effect.Effect<string | undefined>;
	}
>()("vitest-agent/EnvironmentDetector") {}
