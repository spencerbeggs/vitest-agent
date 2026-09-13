/**
 * Help-table drift guard: the static markdown `help` returns must name
 * exactly the tools the toolkit serves and exactly the prompts
 * `PromptsLayer` registers. A tool added to `Kit` (or a prompt added to
 * `prompts/layer.ts`) without a help row — or a row left behind after a
 * removal — fails here instead of quietly misleading the agent that reads
 * `help` to orient (sibling of `served-enum-drift.test.ts`).
 */

import { describe, expect, it } from "vitest";
import { PROMPT_NAMES } from "../src/prompts/layer.js";
import { Kit } from "../src/toolkit.js";
import { HELP_TEXT } from "../src/tools/help.js";

/** The first backticked cell of every table row under the `## <heading>` sections whose first column is `<column>`. */
const tableNames = (column: string): ReadonlyArray<string> => {
	const names: Array<string> = [];
	let inTable = false;
	for (const line of HELP_TEXT.split("\n")) {
		if (line.startsWith(`| ${column} |`)) {
			inTable = true;
			continue;
		}
		if (!line.startsWith("|")) {
			inTable = false;
			continue;
		}
		if (!inTable || line.startsWith("| ---")) continue;
		const match = /^\| `([^`]+)` \|/.exec(line);
		expect(match, `help table row names a ${column.toLowerCase()} in backticks: ${line}`).not.toBeNull();
		if (match?.[1] !== undefined) names.push(match[1]);
	}
	return names;
};

describe("help text drift", () => {
	it("lists exactly the tools the toolkit serves, each once", () => {
		const listed = tableNames("Tool");
		expect(new Set(listed).size, "no tool appears in two help rows").toBe(listed.length);
		expect([...listed].sort()).toEqual(Object.keys(Kit.tools).sort());
	});

	it("lists exactly the prompts PromptsLayer registers, each once", () => {
		const listed = tableNames("Prompt");
		expect(new Set(listed).size, "no prompt appears in two help rows").toBe(listed.length);
		expect([...listed].sort()).toEqual([...PROMPT_NAMES].sort());
		expect(PROMPT_NAMES).toHaveLength(6);
	});
});
