import migration0001 from "./0001_initial.js";
import migration0002 from "./0002_test_artifacts.js";

/**
 * Every migration that must run against a per-project `data.db`, keyed by
 * migration id in application order.
 *
 * This is the single source of truth for the project database's migration
 * set: `ensureMigrated`, the sdk testing layer, `ReporterLive`, `McpLive`,
 * `CliLive` and `SidecarLive` all pass it straight to
 * `SqliteMigrator.fromRecord`, so adding a migration file and registering it
 * here is enough to reach every process that opens a project database.
 *
 * The session-map and discovery-registry databases are separate schemas with
 * their own migrations and are deliberately not listed here.
 *
 * @public
 */
export const PROJECT_MIGRATIONS = {
	"0001_initial": migration0001,
	"0002_test_artifacts": migration0002,
} as const;
