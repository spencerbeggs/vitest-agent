---
type: Limitation
title: The Copilot MCP server cannot locate the project
description: Under GitHub Copilot the plugin's MCP server starts in the plugin root with no project directory, so the loader never finds the project's vitest-agent-mcp bin, falls back to npx, and the server reads a database that is not the project's.
bounds: ../modules/claude-code-plugin.md
status: draft
tags:
  - mcp
  - compat
generated:
  by: okfit/claude-code
  at: 2026-10-10T02:40:34Z
  body_sha256: af35c103a9df4c69e6925612f8c0ba84f5a36579587af9d5ebfb2f2414add683
sources:
  - id: start-mcp-sh
    resource: ../../plugin/bin/start-mcp.sh
  - id: plugin-claude-md
    resource: ../../plugin/CLAUDE.md
  - id: pr-585
    resource: https://github.com/spencerbeggs/vitest-agent/pull/585
---

# The Copilot MCP server cannot locate the project

## Trigger and symptom

The trigger is any GitHub Copilot session with the `plugin/builds/copilot`
plugin loaded. The MCP tools answer, but against the wrong data. They see no
runs, coverage, or TDD state from the project's own Vitest runs, and they
write notes and TDD rows into a database the project's reporter never
reads.

## Cause

A Copilot MCP server starts in the plugin root, and the host hands it no
project directory. pluginfinity measured this on Copilot CLI 1.0.92.
`bin/start-mcp.sh` asks `server_project_dir` for the project, gets a
failure, logs `no project directory for the MCP server`, and falls back to
its working directory.[^start-mcp-sh] From there it finds no
`node_modules/.bin/vitest-agent-mcp`, so it runs the major-pinned
`npx --yes @vitest-agent/mcp@5` fallback, and that server keys its
`data.db` off a directory that is not the project.[^plugin-claude-md] On
Claude Code the same launcher reads `CLAUDE_PROJECT_DIR` and is unaffected.

## Why it is acceptable for now

The hooks and skills, the larger part of the plugin, work on Copilot. Only
the MCP tool surface is wrong there. Claude Code is the primary host and
remains fully supported.

## What a fix would take

The fix belongs in the MCP server rather than the launcher. It would take
the project directory from tool arguments, so an agent passes the project
it is working in, instead of inferring it from the process
environment.[^pr-585] That changes the MCP tool surface, so it ships as a
versioned change to `@vitest-agent/mcp`.

## Related

- [Decision 80 — Build the Agent Plugin from One pluginfinity Source](../decisions/80-build-the-agent-plugin-from-one-pluginfinity-source.md)
- [Decision 30 — Plugin MCP Loader Execs the Consumer's node_modules/.bin](../decisions/30-plugin-mcp-loader-execs-the-consumer-s-node-modules-bin.md)

[^start-mcp-sh]: `../../plugin/bin/start-mcp.sh`
[^plugin-claude-md]: `../../plugin/CLAUDE.md`
[^pr-585]: <https://github.com/spencerbeggs/vitest-agent/pull/585>
