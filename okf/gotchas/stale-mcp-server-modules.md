---
type: Gotcha
status: draft
title: A long-running vitest-agent MCP server keeps old modules after a relink or reinstall
description: "After a dependency relink or reinstall at the same path (a file: override, pnpm install after a branch switch, a lockfile regeneration), run_tests in a running MCP server runs stale code or fails every file with Worker forks emitted error and total 0, while a fresh process is green; nothing is broken in the tree, the server must be restarted."
resource: ../../packages/mcp/src/tools/run-tests.ts
tags: [dx, mcp, deps]
stale_after: "2027-04-25T00:00:00Z"
generated:
  by: okfit/claude-code
  at: 2026-10-25T14:50:28Z
sources:
  - id: run-tests
    resource: ../../packages/mcp/src/tools/run-tests.ts
  - id: issue-549
    resource: https://github.com/spencerbeggs/vitest-agent/issues/549
    title: "Dev tooling follow-ups from the interactive CLI kit adoption"
  - id: issue-461
    resource: https://github.com/spencerbeggs/vitest-agent/issues/461
    title: "Detect lockfile regeneration and warn that the running MCP server may be stale"
  - id: pr-460
    resource: https://github.com/spencerbeggs/vitest-agent/pull/460
integrity:
  generated:
    body: 5bfc0d3c43f7dae3
---

# A long-running vitest-agent MCP server keeps old modules after a relink or reinstall

**What you see.** You relink or reinstall a dependency at the same path —
a `file:` override pointed at a sibling checkout's rebuilt `dist`, a `pnpm
install` after a branch switch, a regenerated lockfile — and the next
`run_tests` call through the vitest-agent MCP server either runs code you
have already replaced or fails every test file with `Worker forks emitted
error` and a total of 0, as if the whole suite were broken. The same
`pnpm vitest run` in a fresh shell is green. The observed forms were
`EnvOverride.readResult is not a function` from a server that had loaded
the previous `@effected/env` while the tree already carried the newer one,
and the all-files `forks` failure on pull request 460.[^issue-549][^pr-460]

**What you will wrongly conclude.** That the relinked dependency, the
branch, or the test suite is broken, and start debugging the tree.

**What is actually true.** Nothing in the tree is wrong. The MCP server is
one long-lived Node process: `run_tests` runs Vitest in-process through
`createVitest`, and Node's module cache keeps every module the server has
already imported — its own `@vitest-agent/*` and `@effected/*` dependency
graph, and the `vitest/node` entry it resolved from the project root — for
the life of the process.[^run-tests] A relink that swaps the files under
those paths changes what a *new* process would load, not what this one
already holds, so the server keeps calling into the old graph: an export
added since the server started "is not a function", and a `vitest/node`
whose pnpm store directory was renamed by a lockfile regeneration spawns
`forks` workers that cannot find their modules. Whether the stale copy
still runs or fails loudly depends only on what moved.

**Remedy.** Restart the server: `/mcp` in Claude Code, or end and reopen
the session. There is no in-process reload. Make the restart a reflex
after any `pnpm install`, `file:` override change, dependency relink, or
branch switch that touches `node_modules`; `vitest-agent db` and the
plugin's hooks are unaffected because each hook call is a fresh CLI
process.

**What the code already catches, and what is coming.** `run_tests` guards
the one form it can detect cheaply: before any side effect it checks that
the `vitest/node` entry it resolved still exists on disk, and when the
lockfile regeneration renamed it away it returns `{ kind: "error" }`
naming the missing path and the `/mcp` restart remedy
(`staleInstallMessage`).[^run-tests] A relink that leaves the path in
place with different contents, which is the `EnvOverride.readResult` form,
is not detected today. Issue 461, in the same sweep as this concept, adds a
stale-install detection to the plugin's hooks and to the `run_tests` error
path so a regenerated lockfile warns that the running server may be
stale.[^issue-461] When that lands, revisit this concept: the trap narrows
to the undetectable relink-in-place.

## Related

- [Module: @vitest-agent/mcp](../modules/mcp.md) — the `run_tests` root
  handling and `vitest/node` resolution the stale check sits in.
- [Decision 51 — The MCP Server Survives Post-Connect Crashes](../decisions/51-the-mcp-server-survives-post-connect-crashes.md)
  — why the server is a long-lived process in the first place.

[^run-tests]: `../../packages/mcp/src/tools/run-tests.ts` (`staleInstallMessage`, `resolveVitestNodeEntry`)
[^issue-549]: <https://github.com/spencerbeggs/vitest-agent/issues/549>
[^issue-461]: <https://github.com/spencerbeggs/vitest-agent/issues/461>
[^pr-460]: <https://github.com/spencerbeggs/vitest-agent/pull/460>
