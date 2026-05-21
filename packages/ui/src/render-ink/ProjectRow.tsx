/**
 * One row of the `workspace`-shape `stream` view: a per-Vitest-project
 * rollup. Carries the project name and the four-outcome count columns.
 *
 * The glyph animates while the project has running modules and resolves
 * to the outcome on finish: ✗ failure, ⧖ timeout, ↷ skip-only, ✓ pass.
 *
 * @packageDocumentation
 */

import { Box, Text } from "ink";
import type { FC, ReactElement } from "react";
import type { ProjectSummary } from "vitest-agent-sdk";
import { formatDisplayDuration } from "../format-duration.js";
import { CountColumns } from "./CountColumns.js";
import { StatusIcon } from "./StatusIcon.js";
import { formatTagSuffix } from "./tag-suffix.js";

export interface ProjectRowProps {
	/** The per-project rollup. */
	readonly project: ProjectSummary;
	/** Pass/fail/skip/timeout counts for the project. */
	readonly counts: { passCount: number; failCount: number; skipCount: number; timeoutCount: number };
	/** True while the project still has a running or queued module. */
	readonly running: boolean;
	/**
	 * True when the run has been timed out — running rows resolve to the
	 * `⧖` glyph instead of continuing to animate the spinner.
	 */
	readonly timedOut?: boolean;
	/** Elapsed milliseconds — wall-clock while running, summed duration once finished. */
	readonly elapsedMs: number;
	/** Current spinner glyph; rendered in place of the status icon while running. */
	readonly frame: string;
	/** Name-column width so the count columns align across rows. */
	readonly nameWidth: number;
	/** Per-tag test counts for the project, merged across its modules. */
	readonly tagCounts?: Record<string, number>;
}

/**
 * Pick the glyph element for the project row using the spec's severity
 * precedence (`✗ > ⧖ > ⚠ > ↷ > ✓`). Skip-only projects (no passes, no
 * failures, no timeouts) resolve to `↷`, not a false-positive `✓`.
 */
const projectGlyph = (
	counts: ProjectRowProps["counts"],
	running: boolean,
	timedOut: boolean,
	frame: string,
): ReactElement => {
	if (running && !timedOut) {
		return <Text color="yellow">{frame}</Text>;
	}
	if (counts.failCount > 0) {
		return <StatusIcon status="failed" />;
	}
	if (counts.timeoutCount > 0 || (running && timedOut)) {
		return <StatusIcon status="timed-out" />;
	}
	if (counts.skipCount > 0 && counts.passCount === 0) {
		return <StatusIcon status="skipped" />;
	}
	return <StatusIcon status="passed" />;
};

export const ProjectRow: FC<ProjectRowProps> = ({
	project,
	counts,
	running,
	timedOut = false,
	elapsedMs,
	frame,
	nameWidth,
	tagCounts,
}) => (
	<Box>
		<Text>{"  "}</Text>
		{projectGlyph(counts, running, timedOut, frame)}
		<Text> {project.name.padEnd(nameWidth)} </Text>
		<CountColumns
			passCount={counts.passCount}
			failCount={counts.failCount}
			skipCount={counts.skipCount}
			timeoutCount={counts.timeoutCount}
		/>
		<Text dimColor> {formatDisplayDuration(elapsedMs)}</Text>
		{formatTagSuffix(tagCounts).length > 0 ? <Text color="cyan"> {formatTagSuffix(tagCounts)}</Text> : null}
	</Box>
);
