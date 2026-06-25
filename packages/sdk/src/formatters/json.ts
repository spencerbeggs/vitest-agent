import type { Formatter, RenderedOutput } from "./types.js";

/** @public */
export const JsonFormatter: Formatter = {
	format: "json",
	render: (reports, _context) => {
		const outputs: RenderedOutput[] = [];
		const json = JSON.stringify(reports, null, 2);
		outputs.push({
			target: "stdout",
			content: json,
			contentType: "application/json",
		});
		return outputs;
	},
};
