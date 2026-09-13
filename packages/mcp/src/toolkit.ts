/**
 * The Effect-native tool surface: one `Toolkit` gathering every tool, the
 * handler record, and the handlers layer `registerStrictToolkit` requires.
 *
 * @packageDocumentation
 */

import { Toolkit } from "effect/unstable/ai";
import { cacheHealthTool, handleCacheHealth } from "./tools/cache-health.js";
import { commitChangesTool, handleCommitChanges } from "./tools/commit-changes.js";
import { configureTool, handleConfigure } from "./tools/configure.js";
import { handleTestCoverage, testCoverageTool } from "./tools/coverage.js";
import { handleTestErrors, testErrorsTool } from "./tools/errors.js";
import { fileCoverageTool, handleFileCoverage } from "./tools/file-coverage.js";
import { handleHelp, helpTool } from "./tools/help.js";
import { handleTestHistory, testHistoryTool } from "./tools/history.js";
import { handleTestOverview, testOverviewTool } from "./tools/overview.js";
import { handlePing, pingTool } from "./tools/ping.js";
import { handleSettingsList, settingsListTool } from "./tools/settings-list.js";
import { handleTestStatus, testStatusTool } from "./tools/status.js";
import { handleTestTrends, testTrendsTool } from "./tools/trends.js";
import { handleTurnSearch, turnSearchTool } from "./tools/turn-search.js";

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
	fileCoverageTool,
	settingsListTool,
	cacheHealthTool,
	configureTool,
	commitChangesTool,
	turnSearchTool,
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
	file_coverage: handleFileCoverage,
	settings_list: handleSettingsList,
	cache_health: handleCacheHealth,
	configure: handleConfigure,
	commit_changes: handleCommitChanges,
	turn_search: handleTurnSearch,
} satisfies Toolkit.HandlersFrom<typeof Kit.tools>;

/**
 * The handlers layer: provides `Tool.HandlersFor<typeof Kit.tools>`.
 *
 * @public
 */
export const ToolsLayer = Kit.toLayer(toolHandlers);
