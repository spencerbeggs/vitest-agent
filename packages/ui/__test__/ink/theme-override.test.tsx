/**
 * A consumer's `CliTheme` token override reaches every Ink render path (issue
 * #677). The tree mounts under a `UiProvider` holding an overriding theme, the
 * same way a tree the kit did not mount gets one; a component that resolved its
 * token against the default palette would still draw the default colour.
 */

import { CliTheme, Token } from "@effected/cli-kit";
import { CliUi, UiProvider } from "@effected/cli-kit/ui";
import { CliUiTest } from "@effected/cli-kit/ui/testing";
import { TerminalEnv } from "@effected/env";
import type { CoverageRenderState, FailureRecord } from "@vitest-agent/sdk";
import { Effect, Layer } from "effect";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import {
	CountColumns,
	CoverageBlock,
	FailureSection,
	FailuresSection,
	StatusIcon,
	SuggestedActions,
	TrendLine,
} from "../../src/ink/index.js";
import { renderAgentStringAsInk } from "../../src/ink/ink-helpers.js";

/** Painted for `failure`, `warning` and `success`; no default palette holds these. */
const FAILURE = "#123456";
const WARNING = "#234567";
const SUCCESS = "#345678";

const themed = Layer.provide(
	CliTheme.layer({
		tokens: { failure: Token.hex(FAILURE), warning: Token.hex(WARNING), success: Token.hex(SUCCESS) },
	}),
	TerminalEnv.layerTest({ stdout: { color: "truecolor" }, stderr: { color: "truecolor" } }),
);

/** `tree`'s frame as markup, drawn under the overriding theme. */
const paint = (tree: ReactElement): Promise<string> =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const value = yield* CliUi.context.pipe(Effect.provide(themed));
				const view = yield* CliUiTest.view(<UiProvider value={value}>{tree}</UiProvider>, {
					columns: 100,
					color: "truecolor",
				});
				return yield* view.frame;
			}),
		),
	);

const failure: FailureRecord = {
	modulePath: "src/math.test.ts",
	suitePath: [],
	testName: "adds",
	classification: null,
	error: { message: "boom", diff: "-old\n+new" },
};

const coverage: CoverageRenderState = {
	metrics: { lines: 10, branches: 90, functions: 90, statements: 90 },
	thresholds: { lines: 80 },
	violations: [{ metric: "lines", actual: 10, expected: 80 }],
	gaps: [],
};

describe("a consumer's token override", () => {
	it.each<[name: string, tree: ReactElement, hex: string]>([
		["StatusIcon", <StatusIcon key="icon" status="failed" />, FAILURE],
		["CountColumns", <CountColumns key="count" passCount={1} failCount={0} skipCount={0} timeoutCount={0} />, SUCCESS],
		["TrendLine", <TrendLine key="trend" trend={{ direction: "regressing", runCount: 2 }} />, WARNING],
		["FailuresSection", <FailuresSection key="many" failures={[failure]} limit={5} />, FAILURE],
		["FailureSection message", <FailureSection key="one" failures={[failure]} />, FAILURE],
		["FailureSection diff", <FailureSection key="diff" failures={[failure]} />, SUCCESS],
		["CoverageBlock", <CoverageBlock key="coverage" coverage={coverage} />, FAILURE],
		[
			"SuggestedActions",
			<SuggestedActions key="actions" actions={[{ severity: "blocker", title: "fix it", detail: "now" }]} />,
			FAILURE,
		],
		["a dispatcher cell's painted glyph", renderAgentStringAsInk("✗ failed"), FAILURE],
		["a dispatcher cell's painted line", renderAgentStringAsInk("Trend: regressing"), WARNING],
	])("reaches %s", async (_name, tree, hex) => {
		expect(await paint(tree)).toContain(`[fg:${hex}]`);
	});
});
