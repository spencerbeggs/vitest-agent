/**
 * Hidden `_internal` subcommand group (transitional shim).
 *
 * Superseded by the discoverable `agent` namespace in `agent.ts`. This
 * thin shim keeps `_internal` working while the command tree is
 * restructured and is removed once `agent` is wired into `bin.ts`.
 *
 * @packageDocumentation
 */

import { Command } from "@effect/cli";
import { endAgentSubcommand, injectEnvSubcommand, registerAgentSubcommand } from "./agent.js";

export const internalCommand = Command.make("_internal").pipe(
	Command.withDescription("Sidecar subcommands invoked by plugin hooks (not user-facing)"),
	Command.withSubcommands([registerAgentSubcommand, endAgentSubcommand, injectEnvSubcommand]),
);
