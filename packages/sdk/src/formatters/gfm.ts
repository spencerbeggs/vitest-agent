import { formatGfm } from "../utils/format-gfm.js";
import type { Formatter, RenderedOutput } from "./types.js";

/** @public */
export const GfmFormatter: Formatter = {
	format: "gfm",
	render: (reports, _context) => {
		const outputs: RenderedOutput[] = [];
		const gfm = formatGfm([...reports]);
		if (gfm) {
			outputs.push({
				target: "github-summary",
				content: gfm,
				contentType: "text/markdown",
			});
		}
		return outputs;
	},
};
