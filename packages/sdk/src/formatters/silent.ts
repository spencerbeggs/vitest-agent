import type { Formatter } from "./types.js";

/** @public */
export const SilentFormatter: Formatter = {
	format: "silent",
	render: () => [],
};
