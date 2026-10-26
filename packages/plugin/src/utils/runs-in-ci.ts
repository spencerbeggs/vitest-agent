import { RuntimeEnv } from "@effected/env";
import { Option } from "effect";

/**
 * Whether the process runs in CI, by `@effected/env`'s `RuntimeEnv` rule: a
 * truthy `GITHUB_ACTIONS`, or a `CI` / `CONTINUOUS_INTEGRATION` that is set,
 * non-empty, and not `false` / `0` (is-in-ci semantics). Reads `process.env`
 * at call time, so the environment in force when the caller runs decides.
 *
 * @internal
 */
export const runsInCi = (): boolean => Option.isSome(RuntimeEnv.fromRecord(process.env).ci);
