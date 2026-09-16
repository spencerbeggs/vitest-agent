# Runbook

* [Add a schema migration to the project database](add-a-migration.md) - How to add a new incremental SQLite migration for the project data.db without editing the frozen 0001\_initial migration, registered once in the single PROJECT\_MIGRATIONS record every consumer defaults to.
* [Add an MCP tool](add-an-mcp-tool.md) - How to add a new tool to the vitest-agent-mcp server's Effect-native toolkit, from the Tool.make value through the strict-input test and the help listing.
* [Release a package (or the Claude Code plugin)](release.md) - The changeset-to-publish pipeline for the independently versioned vitest-agent family, including the one ordering gate (engine before plugin) that a release must satisfy.
* [Reset the local vitest-agent database](reset-the-database.md) - How to wipe or locate a project's data.db after a schema-affecting source edit or a SQLite disk I/O error, including db reset's exact confirmation gates and the delete-the-sidecars-too caveat.
