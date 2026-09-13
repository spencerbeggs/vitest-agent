/**
 * The Effect-native tool surface: one `Toolkit` gathering every tool, the
 * handler record, and the handlers layer `registerStrictToolkit` requires.
 *
 * @packageDocumentation
 */

import { Toolkit } from "effect/unstable/ai";
import { handleTestCoverage, testCoverageTool } from "./tools/coverage.js";
import { handleTestErrors, testErrorsTool } from "./tools/errors.js";
import { handleHelp, helpTool } from "./tools/help.js";
import { handleTestHistory, testHistoryTool } from "./tools/history.js";
import { handleTestOverview, testOverviewTool } from "./tools/overview.js";
import { handlePing, pingTool } from "./tools/ping.js";
import { handleTestStatus, testStatusTool } from "./tools/status.js";
import { handleTestTrends, testTrendsTool } from "./tools/trends.js";

/**
 * Every tool the server registers.
 *
 * @public
 */
export const Kit = Toolkit.make(
	pingTool,
	helpTool,
	testStatusTool,
	testOverviewTool,
	testCoverageTool,
	testHistoryTool,
	testTrendsTool,
	testErrorsTool,
);

/**
 * The handler for each tool in {@link Kit}, keyed by tool name.
 *
 * @public
 */
export const toolHandlers = {
	ping: handlePing,
	help: handleHelp,
	test_status: handleTestStatus,
	test_overview: handleTestOverview,
	test_coverage: handleTestCoverage,
	test_history: handleTestHistory,
	test_trends: handleTestTrends,
	test_errors: handleTestErrors,
} satisfies Toolkit.HandlersFrom<typeof Kit.tools>;

/**
 * The handlers layer: provides `Tool.HandlersFor<typeof Kit.tools>`.
 *
 * @public
 */
export const ToolsLayer = Kit.toLayer(toolHandlers);
