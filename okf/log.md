# Log

## 2026-10-03

* Updated @vitest-agent/ui
* Updated RunEvent and RenderState
* Updated @vitest-agent/sdk
* Updated Carrier Pattern and Ranked Layering
* Updated Effect Services over Plain Functions
* Updated Output Pipeline Architecture
* Updated Package Split
* Updated @vitest-agent/reporter
* Added Adopt @effected/store with Ledger Adopt and Mirror
* Added Concurrent first open of a new database can die at the WAL switch
* Updated Keep ensureMigrated Instead of the Kit's SQLite-State Layer
* Updated Only stream mode renders progressively; every other console mode paints once at run end
* Updated @vitest-agent/engine
* Updated Add a schema migration to the project database
* Added Adopt @effected/store with an Adopt-Only Ledger
* Added Older installs cannot open databases this version created
* Updated SQLite Schema
* Updated Schema migrations — append-only, one registry, never edit 0001
* Updated @vitest-agent/cli
* Updated @vitest-agent/plugin
* Updated Add an MCP tool
* Updated AgentPluginOptions
* Updated Claude Code hook environment contract
* Added Effect.provide reuses the inherited layer memo map
* Updated MCP Permits, Agent Restricts (Capability vs Scoping)
* Updated Reset the local vitest-agent database
* Updated The `vitest-agent` CLI command tree
* Updated The record hook subcommands have no built-and-spawned end-to-end test
* Updated vitest-agent (Claude Code plugin)

## 2026-10-01

* Updated AgentPlugin.discover() / DiscoverStrategy
* Updated AgentPluginOptions
* Updated Executor vs. console mode
* Updated Package boundaries — process reads and forbidden imports
* Updated Reset the local vitest-agent database
* Updated Test layout — flat __test__ directories, src co-location, and kind-by-suffix
* Updated @vitest-agent/engine
* Updated @vitest-agent/plugin
* Updated Reach for effect/cli, effect/sql, and effect/ai, not a v3 @effect/* package
* Updated @vitest-agent/cli
* Updated Claude Code hook environment contract
* Updated The `vitest-agent` CLI command tree
* Updated @vitest-agent/reporter
* Updated @vitest-agent/sdk
* Updated Only stream mode renders progressively; every other console mode paints once at run end
* Updated Reporter
* Updated Reporter contract
* Updated There is no standalone reporter usage outside the plugin

## 2026-09-30

* Updated Test patterns — layers, in-process MCP, spawned-bin crash injection, and virtual filesystems
* Added The Walker Test Adapter Sits on memfs' Promises Port

## 2026-09-29

* Updated @vitest-agent/engine
* Updated Deterministic XDG Path Resolution
* Added Reporter and MCP history looks wiped after an upgrade but sits orphaned under ~/.vitest-agent
* Updated Reset the local vitest-agent database
* Updated XDG data-root fallback splits between the reporter and the hook routes
* Updated @vitest-agent/mcp
* Updated Front-end entry contract — bin.ts / main.ts / index.ts / version.ts
* Updated MCP tool and prompt surface
* Updated Adopt the Effected Front-End Kit
* Updated Adoption Helpers Live in the Kit
* Updated AgentPluginOptions Is a Closed, Minimal Shape
* Updated CLAUDE_ENV_FILE Auto-Source and Hook Self-Source Bridge
* Updated Cap Inline Attachment Bodies on Stored Bytes, Not the Reported Size
* Updated Carrier Pattern and Ranked Layering
* Updated Claude Code Plugin as a Release-Only pnpm Workspace
* Updated Conversation-Tree Fallback and Task-Id Escape Hatch
* Updated Coverage Policy — Presets, ConfigValidation, Full and UI-only Modes
* Updated Detect Partial Runs and Neutralise the Native Threshold Check
* Updated Drop Vitest 4, Require vitest 5
* Updated Effect Schema Data Structures
* Updated Effect Services over Plain Functions
* Updated Effect v4 + effected Kit Behavior Changes
* Updated Effect-Native MCP Server
* Updated Explicit suite Marker for bats Run-Level Artifacts
* Updated Fail Open on Non-Default Discovery via Lexical Config Detection
* Updated Fence Hook Stdout at the Library, Not the Call Site
* Updated Framing-Only MCP Prompts
* Updated GFM Output for GitHub Actions
* Updated Honest Run Reporting
* Updated Independent Per-Package Release
* Updated Junction Table for Behavior Dependencies
* Updated Keep ensureMigrated Instead of the Kit's SQLite-State Layer
* Updated MCP Attachment Bodies Are Opt-In and Budgeted
* Updated MCP Permits, Agent Restricts (Capability vs Scoping)
* Updated Migration 0002 Drops the Dead Table and ALTERs the Live Ones
* Updated Output Pipeline Architecture
* Updated Package Split
* Updated Partition the consoleLeaks Signal by Test Outcome
* Updated Per-Executor Console Matrix + Streaming Reporter Tap
* Updated Per-Instance Identity from CLAUDE_PLUGIN_DATA and session_id
* Updated Per-Invocation Coverage Directory for MCP Runs
* Updated Per-Process Coverage Directory for Plain-CLI Agent Runs
* Updated Persist Thresholds, Targets and Baselines as Three Facets
* Updated Plugin MCP Loader Execs the Consumer's node_modules/.bin
* Updated Plugin/Reporter Split
* Updated Process-Level Migration Coordination via globalThis Cache
* Updated Rendering Never Depends on Persistence
* Updated Report Files Are a Versioned Public Contract
* Updated SQLite over JSON Files
* Updated Serialize runScript Builds with a File-Based Advisory Lock
* Updated Shape-Tailored Dispatcher Matrix
* Updated Sidecar CLI over mcp_tool Hooks
* Updated Single Pre-2.0 Migration, Incremental After
* Updated Single-Source Served MCP Discriminants
* Updated Stable Failure Signatures via AST Function Boundary
* Updated Suite-Load Failures Count as Failures
* Updated TDD Phase-Transition Evidence Binding
* Updated Test patterns — layers, in-process MCP, spawned-bin crash injection, and virtual filesystems
* Updated Three-Layer Sidecar Performance Fix
* Updated Three-Tier Objective→Goal→Behavior Hierarchy
* Updated Unified DiscoverStrategy + DiscoverBuilder
* Updated Vitest-Native Tag Classification
* Updated run_tests Timeout as a Typed Effect Error
* Updated tdd_phases behavior_id Cascade
* Updated vitest-agent.config.toml

## 2026-09-28

* Updated @vitest-agent/cli
* Updated @vitest-agent/mcp
* Updated Effect v4 + effected Kit Behavior Changes
* Updated Effect-Native MCP Server
* Updated MCP tool and prompt surface
* Updated Reach for effect/cli, effect/sql, and effect/ai, not a v3 @effect/* package
* Updated Sidecar hook latency
* Updated Strict MCP tool inputs — every served input rejects unknown keys
* Updated Test patterns — layers, in-process MCP, spawned-bin crash injection, and virtual filesystems
* Updated The record hook subcommands have no built-and-spawned end-to-end test
* Updated vitest-agent

## 2026-09-25

* Updated @vitest-agent/cli
* Updated @vitest-agent/engine
* Updated @vitest-agent/mcp
* Updated @vitest-agent/plugin
* Updated Add an MCP tool
* Added Adopt the Effected Front-End Kit
* Updated An interactive exit can print "Hook cancelled" even though SessionEnd succeeded
* Updated Carrier
* Updated Carrier Pattern and Ranked Layering
* Updated Claude Code Plugin as a Release-Only pnpm Workspace
* Updated Claude Code hook environment contract
* Updated Effect Schema Data Structures
* Updated Effect-Native MCP Server
* Updated Front-end entry contract — bin.ts / main.ts / index.ts / version.ts
* Updated MCP tool and prompt surface
* Updated Package boundaries — process reads and forbidden imports
* Updated Partition the consoleLeaks Signal by Test Outcome
* Updated Plugin MCP Loader Execs the Consumer's node_modules/.bin
* Updated Ranked layering — every workspace edge points strictly downward
* Updated Reach for effect/unstable/*, not a v3 @effect/* package
* Updated Single-Source Served MCP Discriminants
* Updated Strict MCP Tool Inputs
* Updated Strict MCP tool inputs — every served input rejects unknown keys
* Updated TDD Phase-Transition Evidence Binding
* Updated Test patterns — layers, in-process MCP, spawned-bin crash injection, and virtual filesystems
* Updated The MCP Server Survives Post-Connect Crashes
* Updated The `vitest-agent` CLI command tree
* Updated vitest-agent (Claude Code plugin)
* Updated workspace
* Added Adoption Helpers Live in the Kit
* Updated Import style — extensions, protocol, type-only, and static-only

## 2026-09-22

* Updated @vitest-agent/mcp
* Updated Add an MCP tool
* Updated Effect-Native MCP Server
* Updated MCP tool and prompt surface
* Updated Strict MCP Tool Inputs
* Updated Strict MCP tool inputs — every served input rejects unknown keys
* Updated @vitest-agent/sdk

## 2026-09-20

* Updated Effect Schema Data Structures

## 2026-09-16

* Updated @vitest-agent/plugin
* Updated @vitest-agent/sdk
* Updated Carrier Pattern and Ranked Layering
* Updated Detect Partial Runs and Neutralise the Native Threshold Check
* Updated Published JSON Schema documents
* Updated Release a package (or the Claude Code plugin)
* Updated Report Files Are a Versioned Public Contract
* Updated Report files
* Updated docs (website/)
* Updated vitest-agent (Claude Code plugin)

## 2026-09-14

* Initialized the bundle with the software-project profile
* Added @vitest-agent/cli
* Added @vitest-agent/engine
* Added @vitest-agent/reporter
* Added @vitest-agent/sdk/dispatch
* Added @vitest-agent/sidecar
* Added @vitest-agent/ui
* Added Add a schema migration to the project database
* Added AgentPlugin.discover() / DiscoverStrategy
* Added AgentPluginOptions
* Added AgentPluginOptions Is a Closed, Minimal Shape
* Added An interactive exit can print "Hook cancelled" even though SessionEnd succeeded
* Added CLAUDE_ENV_FILE Auto-Source and Hook Self-Source Bridge
* Added Cap Inline Attachment Bodies on Stored Bytes, Not the Reported Size
* Added Carrier
* Added Claude Code Plugin as a Release-Only pnpm Workspace
* Added Claude Code hook environment contract
* Added Commit and changeset discipline
* Added Conversation-Tree Fallback and Task-Id Escape Hatch
* Added Coverage Policy — Presets, ConfigValidation, Full and UI-only Modes
* Added Coverage targets — thresholds, exclusions, and remap ordering
* Added Deterministic XDG Path Resolution
* Added Dispatcher Matrix
* Added Drop Vitest 4, Require vitest 5
* Added Effect Services over Plain Functions
* Added Effect v4 + effected Kit Behavior Changes
* Added Executor vs. console mode
* Added Explicit suite Marker for bats Run-Level Artifacts
* Added Fail Open on Non-Default Discovery via Lexical Config Detection
* Added Fence Hook Stdout at the Library, Not the Call Site
* Added Framing-Only MCP Prompts
* Added Front-end entry contract — bin.ts / main.ts / index.ts / version.ts
* Added GFM Output for GitHub Actions
* Added Honest Run Reporting
* Added Import style — extensions, protocol, type-only, and static-only
* Added Independent Per-Package Release
* Added Junction Table for Behavior Dependencies
* Added Keep ensureMigrated Instead of the Kit's SQLite-State Layer
* Added MCP Attachment Bodies Are Opt-In and Budgeted
* Added MCP Permits, Agent Restricts (Capability vs Scoping)
* Added Migration 0002 Drops the Dead Table and ALTERs the Live Ones
* Added Never set private to false in a source package.json
* Added Only one project's reporter instance processes the shared coverage map
* Added Only stream mode renders progressively; every other console mode paints once at run end
* Added Output Pipeline Architecture
* Added Package Split
* Added Package boundaries — process reads and forbidden imports
* Added Partition the consoleLeaks Signal by Test Outcome
* Added Per-Executor Console Matrix + Streaming Reporter Tap
* Added Per-Instance Identity from CLAUDE_PLUGIN_DATA and session_id
* Added Per-Invocation Coverage Directory for MCP Runs
* Added Per-Process Coverage Directory for Plain-CLI Agent Runs
* Added Persist Thresholds, Targets and Baselines as Three Facets
* Added Plugin MCP Loader Execs the Consumer's node_modules/.bin
* Added Plugin/Reporter Split
* Added Process-Level Migration Coordination via globalThis Cache
* Added Ranked layering — every workspace edge points strictly downward
* Added Reach for effect/unstable/*, not a v3 @effect/* package
* Added Rendering Never Depends on Persistence
* Added Reporter
* Added Reporter contract
* Added Reset the local vitest-agent database
* Added Root prepare stays husky-only — never a build step
* Added RunEvent and RenderState
* Added SQLite Schema
* Added SQLite over JSON Files
* Added Schema migrations — append-only, one registry, never edit 0001
* Added Scoped-run source mapping is a filename regex, not an import graph
* Added Serialize runScript Builds with a File-Based Advisory Lock
* Added Shape-Tailored Dispatcher Matrix
* Added Sidecar CLI over mcp_tool Hooks
* Added Sidecar hook latency
* Added Single Pre-2.0 Migration, Incremental After
* Added Single-Source Served MCP Discriminants
* Added Stable Failure Signatures via AST Function Boundary
* Added Suite-Load Failures Count as Failures
* Added TDD Phase-Transition Evidence Binding
* Added Test kind vs. Vitest tag
* Added Test layout — flat __test__ directories, src co-location, and kind-by-suffix
* Added Test patterns — layers, in-process MCP, spawned-bin crash injection, and virtual filesystems
* Added Test-path classification — one rule for what is a discoverable test
* Added The MCP Server Survives Post-Connect Crashes
* Added The RenderedOutput file target is a reserved no-op
* Added The `vitest-agent` CLI command tree
* Added The persisted database is a binary SQLite file, not a human-readable cache
* Added The plugin peers on vitest ^5.0.0 with no support for Vitest 4
* Added The record hook subcommands have no built-and-spawned end-to-end test
* Added The reporter builds a fresh Effect layer on every onTestRunEnd call
* Added There is no standalone reporter usage outside the plugin
* Added Three-Layer Sidecar Performance Fix
* Added Three-Tier Objective→Goal→Behavior Hierarchy
* Added Unified DiscoverStrategy + DiscoverBuilder
* Added Vitest-Native Tag Classification
* Added XDG data-root fallback splits between the reporter and the hook routes
* Added chatId, sessionId, tddTaskId
* Added playground
* Added run_tests Timeout as a Typed Effect Error
* Added tdd_phase_transition_request is annotated Idempotent but is not
* Added tdd_phases behavior_id Cascade
* Added vitest-agent
* Added vitest-agent.config.toml
* Added workspace
