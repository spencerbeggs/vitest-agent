import type { Effect } from "effect";
import { Context } from "effect";
import type { Environment } from "../schemas/Common.js";
/** @public */
export class EnvironmentDetector extends Context.Tag("vitest-agent/EnvironmentDetector")<
	EnvironmentDetector,
	{
		readonly detect: () => Effect.Effect<Environment>;
		readonly isAgent: Effect.Effect<boolean>;
		readonly agentName: Effect.Effect<string | undefined>;
	}
>() {}
