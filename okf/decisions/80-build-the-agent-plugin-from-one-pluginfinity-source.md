---
type: Decision
title: Build the Agent Plugin from One pluginfinity Source for Claude Code and Copilot
description: The agent plugin is one host-neutral source at plugin/ (pluginfinity.config.ts plus hooks, skills, agent and MCP launcher) that pluginfinity builds into a Claude Code plugin and a GitHub Copilot plugin, both generated into plugin/builds/ and committed.
status: stable
tags:
  - architecture
  - dx
generated:
  by: okfit/claude-code
  at: 2026-10-10T02:40:34Z
  body_sha256: 2f6315ba8b815f000041d1ef60ef86f565432331c824b133406fa62bb99b8bdb
sources:
  - id: pluginfinity-config
    resource: ../../plugin/pluginfinity.config.ts
  - id: plugin-claude-md
    resource: ../../plugin/CLAUDE.md
  - id: claude-build-manifest
    resource: ../../plugin/builds/claude/.claude-plugin/plugin.json
  - id: copilot-build-manifest
    resource: ../../plugin/builds/copilot/plugin.json
  - id: pr-585
    resource: https://github.com/spencerbeggs/vitest-agent/pull/585
verified:
  - by: human:spencer
    at: 2026-10-10T02:23:56Z
---

# Build the Agent Plugin from One pluginfinity Source for Claude Code and Copilot

## Context

The agent plugin was a hand-written Claude Code plugin at
`plugins/claude-code/`: a hand-maintained `hooks/hooks.json`, a vendored
`hooks/lib/` of shell helpers (`emit_*` response writers, a stdout fence, a
session-env bridge, CLI resolution), three slash commands, and a POSIX
loader for the MCP server. Every one of those pieces encoded Claude Code's
hook payloads, response shapes, and environment surface directly, so a
second host (GitHub Copilot) would have meant a second copy of all of it.

## Decision

The plugin is one host-neutral source at `plugin/`, built by
[pluginfinity](https://github.com/spencerbeggs/pluginfinity).[^pr-585]
`pluginfinity.config.ts` declares the plugin's name and metadata, the
session-env values, every hook entry (written in Claude Code's event names
and matchers), the MCP server, and the per-host overrides; the hook
scripts, the `tdd-task` agent, the skills, and `bin/start-mcp.sh` sit
beside it.[^pluginfinity-config] `pluginfinity build` writes two plugins:

- `plugin/builds/claude/` — the Claude Code plugin, with
  `.claude-plugin/plugin.json` and a generated `hooks/hooks.json`.[^claude-build-manifest]
- `plugin/builds/copilot/` — the GitHub Copilot plugin, with `plugin.json`,
  `mcp.json`, and `com.github.copilot/{agents,hooks}/`.[^copilot-build-manifest]

Both builds are generated and committed; neither is ever edited by hand,
and `pluginfinity build --check` fails when a build is stale. The
pluginfinity hook, server, log, and session-env libraries are written only
into `builds/`, never vendored into the source. Hook scripts run on that
library ([Decision 83](83-hook-responses-through-the-pluginfinity-hook-library.md)),
session values travel through its session env ([Decision
82](82-session-values-through-pluginfinity-session-env.md)), and the three
former slash commands became the user-invoked skills
`/vitest-agent:tdd`, `/vitest-agent:setup`, and
`/vitest-agent:configure`.[^plugin-claude-md] Scripts branch on
`hook_supports <capability>`, never on the host name.

## Alternatives rejected

- **Keep the hand-written Claude Code plugin and add a parallel Copilot
  plugin.** Rejected: two copies of every hook, the response helpers, and
  the env bridge would drift, and each hook fix would have to land twice.
- **Keep the vendored `hooks/lib` and only generate the manifests.**
  Rejected: the vendored helpers are exactly the Claude-specific layer a
  second host needs translated (payload casing, response shapes, the
  environment surface), so keeping them would leave the port undone.

## Consequences

- A source edit is not live until `pluginfinity build` runs, and
  `builds/` must be committed with the source change.
- Copilot gets the hooks and skills but not full parity: its MCP server
  cannot learn the project ([Limitation: Copilot MCP server cannot locate
  the project](../limitations/copilot-mcp-server-cannot-locate-the-project.md)),
  and it registers no agents and may not fire the TDD-scoped hooks
  ([Limitation: Copilot sessions carry no agent
  attribution](../limitations/copilot-sessions-carry-no-agent-attribution.md)).
- Sourcing the library costs about 50 ms per hook, which regressed the
  Bash hook's hot path; see [Measurement: pluginfinity hook latency,
  2026-10-09](../measurements/pluginfinity-hook-latency-2026-10-09.md). The
  fix is tracked upstream as spencerbeggs/pluginfinity issue 26.
- The plugin's release handle is the `@vitest-agent/ai-plugins` tracking
  package; see [Decision
  81](81-ai-plugins-as-a-release-only-pnpm-workspace.md).

## Related

- [Module: vitest-agent agent plugin](../modules/claude-code-plugin.md)
- [Interface: hook environment contract](../interfaces/hook-env-contract.md)

[^pr-585]: <https://github.com/spencerbeggs/vitest-agent/pull/585>
[^pluginfinity-config]: `../../plugin/pluginfinity.config.ts`
[^claude-build-manifest]: `../../plugin/builds/claude/.claude-plugin/plugin.json`
[^copilot-build-manifest]: `../../plugin/builds/copilot/plugin.json`
[^plugin-claude-md]: `../../plugin/CLAUDE.md`
