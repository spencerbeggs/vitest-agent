/**
 * Per-module title line: status glyph, module path, and inline counts.
 *
 * @packageDocumentation
 */

import { Box, Text } from "ink";
import type { FC } from "react";
import * as React from "react";
import type { ModuleRecord } from "vitest-agent-sdk";
import type { StatusIconKind } from "./StatusIcon.js";
import { StatusIcon } from "./StatusIcon.js";

export interface ModuleHeaderProps {
	readonly module: ModuleRecord;
}

const moduleGlyph = (m: ModuleRecord): StatusIconKind => {
	if (m.status === "queued") return "queued";
	if (m.status === "running") return "running";
	if (m.failCount > 0) return "failed";
	return "passed";
};

export const ModuleHeader: FC<ModuleHeaderProps> = ({ module }) => {
	const parts: string[] = [];
	if (module.passCount > 0) parts.push(`${module.passCount} passed`);
	if (module.failCount > 0) parts.push(`${module.failCount} failed`);
	if (module.skipCount > 0) parts.push(`${module.skipCount} skipped`);
	const summary = parts.length > 0 ? parts.join(", ") : module.status;

	return (
		<Box>
			<StatusIcon status={moduleGlyph(module)} />
			<Text> {module.modulePath}</Text>
			<Text dimColor>
				{" "}
				({summary}, {module.durationMs}ms)
			</Text>
		</Box>
	);
};
