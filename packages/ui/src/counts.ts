/**
 * The one test-totals line every agent-string path prints, as a kit
 * `Doc.counts` block rendered plain for the agent audience.
 *
 * `<label>: <pass>/<total> passed[, <fail> failed][, <timeout> timed out]
 * [, <skip> skipped][, <n> unhandled error(s)] (<duration>)[ <suffix>]`.
 * A zero counter is hidden except `passed`; `total` folds timed-out tests in
 * (a timed-out test is a real collected test, issue #224) but never the
 * unhandled-error count, which is not a test.
 *
 * @packageDocumentation
 */

import type { Counter } from "@effected/cli";
import { Doc, Render } from "@effected/cli";
import { VitestAgentStatus } from "./theme.js";

/** The test counters a totals line folds into its `n/total`. */
const TEST_KEYS: ReadonlySet<string> = new Set(["pass", "fail", "timeout", "skip"]);

/** An agent is always escape-free; colour none, no links, no width. */
const AGENT_CONTEXT = Render.contextOf({ audience: "agent" });

/**
 * The inputs of one totals line.
 *
 * @internal
 */
export interface TotalsLineInput {
	readonly label: string;
	readonly passCount: number;
	readonly failCount: number;
	readonly timeoutCount: number;
	readonly skipCount: number;
	readonly durationMs: number;
	/** Unhandled errors, shown after the test counters and never summed into the total. */
	readonly unhandledErrors?: number;
	/** Text after the duration, such as `across 3 files`. */
	readonly suffix?: string;
}

const sumTests = (counters: ReadonlyArray<Counter>): number =>
	counters.reduce((sum, c) => (TEST_KEYS.has(c.key) ? sum + c.n : sum), 0);

/**
 * Render one totals line as plain agent text.
 *
 * @internal
 */
export const formatTotalsLine = (input: TotalsLineInput): string => {
	const unhandled = input.unhandledErrors ?? 0;
	const counters: Counter[] = [
		Doc.counter(VitestAgentStatus, "success", { key: "pass", label: "passed", n: input.passCount, showZero: true }),
		Doc.counter(VitestAgentStatus, "failure", { key: "fail", label: "failed", n: input.failCount }),
		Doc.counter(VitestAgentStatus, "timeout", { key: "timeout", label: "timed out", n: input.timeoutCount }),
		Doc.counter(VitestAgentStatus, "skip", { key: "skip", label: "skipped", n: input.skipCount }),
		Doc.counter(VitestAgentStatus, "failure", {
			key: "unhandled",
			label: { one: "unhandled error", other: "unhandled errors" },
			n: unhandled,
		}),
	];
	return Render.plain(
		[
			Doc.counts({
				label: input.label,
				counters,
				total: sumTests,
				durationMs: input.durationMs,
				layout: "inline",
				...(input.suffix !== undefined ? { suffix: input.suffix } : {}),
			}),
		],
		AGENT_CONTEXT,
	);
};
