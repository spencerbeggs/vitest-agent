import type { CiName } from "@effected/env";
import type { Environment } from "@vitest-agent/sdk";
import type { Effect, Option } from "effect";
import { Context } from "effect";
/**
 * Who is running the program and where.
 *
 * @remarks
 * `detect` is the console audience: an agent marker wins over CI, so an
 * agent inside GitHub Actions reads `agent-shell`. `ci` is the CI vendor
 * independently of that precedence, so a caller can keep GitHub-only
 * extras (the step summary, annotations, the `github-actions` reporter)
 * on for the humans reviewing the job even when the console audience is
 * the agent (issue #624).
 *
 * @public
 */
export class EnvironmentDetector extends Context.Service<
	EnvironmentDetector,
	{
		readonly detect: () => Effect.Effect<Environment>;
		readonly isAgent: Effect.Effect<boolean>;
		readonly agentName: Effect.Effect<string | undefined>;
		readonly ci: Effect.Effect<Option.Option<CiName>>;
	}
>()("vitest-agent/EnvironmentDetector") {}
