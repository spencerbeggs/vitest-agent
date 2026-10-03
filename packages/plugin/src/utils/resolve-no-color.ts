import { TerminalEnv } from "@effected/env";
import { Effect } from "effect";

/**
 * Whether the reporter should render without colour, decided by the kit's
 * terminal rule rather than `NO_COLOR` alone: `FORCE_COLOR` beats `NO_COLOR`,
 * and `NODE_DISABLE_COLORS`, `TERM=dumb` and a non-TTY stdout all disable it.
 */
export const resolveNoColor = TerminalEnv.colorLevel("stdout").pipe(Effect.map((level) => level === "none"));
