// Flag defaults that must be computed when a command is parsed, not when its
// module is loaded. `Flag.withDefault` accepts an Effect and runs it only when
// the flag is absent, so a default timestamp is the time of the call and a
// default cwd is the cwd of the call, not of the bin's module evaluation.

import { DateTime, Effect } from "effect";

/** The current instant as an ISO 8601 string, read from the `Clock` when the flag is absent. */
export const nowIso: Effect.Effect<string> = Effect.map(DateTime.now, DateTime.formatIso);

/** The process working directory, read when the flag is absent. */
export const currentCwd: Effect.Effect<string> = Effect.sync(() => process.cwd());
