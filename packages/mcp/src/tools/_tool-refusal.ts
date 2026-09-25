// The declared failure for a call the agent can fix itself.
//
// Core sends a declared `Error`-shaped failure as `isError` with
// `error.message` as the only text, while an undeclared failure or defect
// reaches the agent only as a generic internal-error sentence. A refusal the
// agent must act on (an unknown id, a missing argument) is therefore a
// declared `ToolRefusal` whose message folds in the remediation, via
// `ToolFailure.message`. Tools that already answer with an `ok: false`
// success envelope keep using it; this is for the ones that do not.

import type { Remediation } from "@effected/engine";
import { ToolFailure } from "@effected/mcp";
import { Schema } from "effect";

/**
 * A tool call refused for a reason the caller can fix. The message already
 * carries the remediation's hint and suggested tool.
 *
 * @public
 */
export class ToolRefusal extends Schema.TaggedError<ToolRefusal>()("ToolRefusal", {
	...ToolFailure.fields,
}) {}

/**
 * A {@link ToolRefusal} for `reason`, with `remediation` folded into its
 * message. `reason` must already truncate any caller-supplied value it
 * echoes (`ToolFailure.truncate`).
 *
 * @internal
 */
export const refuse = (reason: string, remediation: Remediation): ToolRefusal =>
	new ToolRefusal({ message: ToolFailure.message(reason, remediation), remediation });
