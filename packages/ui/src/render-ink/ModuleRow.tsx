/**
 * Composite module row: header plus optional child test rows.
 *
 * @packageDocumentation
 */

import { Box } from "ink";
import type { FC } from "react";
import type { ModuleRecord } from "vitest-agent-sdk";
import { ModuleHeader } from "./ModuleHeader.js";
import { TestRow } from "./TestRow.js";

export interface ModuleRowProps {
	readonly module: ModuleRecord;
	readonly showTests?: boolean;
}

export const ModuleRow: FC<ModuleRowProps> = ({ module, showTests = false }) => (
	<Box flexDirection="column">
		<ModuleHeader module={module} />
		{showTests
			? module.tests.map((test) => <TestRow key={`${test.suitePath.join("/")}::${test.testName}`} test={test} />)
			: null}
	</Box>
);
