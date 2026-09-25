---
type: Invariant
title: Package boundaries — process reads and forbidden imports
description: Each of sdk, engine, cli, and mcp carries a boundaries.test.ts that scans its own src/ for forbidden process reads and forbidden cross-package imports, pinning the platform-free core, the process-free engine, and the two front ends' narrow process allowlists.
tags: [architecture, effect]
resource: ../../packages/sdk/__test__/boundaries.test.ts
sources:
  - id: sdk-boundaries
    resource: ../../packages/sdk/__test__/boundaries.test.ts
  - id: engine-boundaries
    resource: ../../packages/engine/__test__/boundaries.test.ts
  - id: cli-boundaries
    resource: ../../packages/cli/__test__/boundaries.test.ts
  - id: mcp-boundaries
    resource: ../../packages/mcp/__test__/boundaries.test.ts
generated:
  by: okfit/claude-code
  at: 2026-09-25T17:01:39Z
  body_sha256: 6a4ab4d163621c1f62f9187ac2df1560700a482442936f89d8a46c4b74510e60
---

# Package boundaries — process reads and forbidden imports

## Property

Four packages — `@vitest-agent/sdk`, `@vitest-agent/engine`,
`@vitest-agent/cli`, and `@vitest-agent/mcp` — each carry a source-scanning
test, `__test__/boundaries.test.ts`, that pins two properties about every
file under that package's own `src/`: which files, if any, may read the
global `process` object, and which packages that source may import. All
four run the same scanner, `@effected/workspaces/testing`'s
`SourceBoundary.scan`, so the four sets of assertions below are
variations on one mechanism, not four implementations.

- **sdk** — no file under `src/` may import `node:*`, a bare Node
  built-in (`fs`, `path`, …), `@effect/platform-node`,
  `@effect/sql-sqlite-node`, or any `@effected/*` package, and no file may
  read `process` or import `node:process`[^sdk-boundaries].
- **engine** — no file under `src/` may read `process` or import
  `node:process`, with no allowlist at all, and no file may import
  `@vitest-agent/cli`, `@vitest-agent/mcp`, `@vitest-agent/plugin`,
  `@vitest-agent/reporter`, or `@vitest-agent/ui`[^engine-boundaries].
- **cli** — `process` may be read only in `main.ts` or a file under
  `commands/**`; no file under `src/` may import `@vitest-agent/mcp`,
  `@vitest-agent/plugin`, `@vitest-agent/reporter`, or
  `@vitest-agent/ui`[^cli-boundaries].
- **mcp** — `process` may be read only in `main.ts` or
  `tools/run-tests.ts`; only `tools/run-tests.ts` may write to stdout, and
  no file may call a `console` stdout method, because stdout is the
  JSON-RPC wire; no file may import `@vitest-agent/cli`,
  `@vitest-agent/plugin`, `@vitest-agent/reporter`, `@vitest-agent/ui`,
  `@modelcontextprotocol/sdk`, `@trpc/server`, or `zod`[^mcp-boundaries].

Across all four, the literal token `process.env.__PACKAGE_VERSION__` is
exempt from the `process` rule everywhere, so each test separately pins
where it may appear: the list of files containing it must equal exactly
`["version.ts"]`.

## Mechanism

Each `boundaries.test.ts` calls `SourceBoundary.scan({ root, rules,
allowRules })` over its package's `src/`. The scanner blanks comments
before matching, leaving strings, templates and regexes untouched, and
reports every offence as a file, a position and a rule. `allowRules`
waives one rule for the files its globs match — cli waives `process` for
`main.ts` and `commands/**`; mcp waives `process` for `main.ts` and
`tools/run-tests.ts`, and `stdout-write` for `tools/run-tests.ts`. A
waived file is still checked against every other rule, including the
forbidden imports[^cli-boundaries][^mcp-boundaries]. sdk and engine
waive nothing[^sdk-boundaries][^engine-boundaries].

Each test also guards against passing vacuously. It first asserts
`SourceBoundary.verifyFixtures()` returns no failures, which proves the
scanner still flags and spares the fixtures it ships with. It then
asserts the scan read a non-zero number of files, so a mistyped root
cannot report a clean boundary. The cli test additionally asserts
`main.ts` appears among the waived offences, which proves the allowlist
is live.

## What a refactor would have to break

Because these are textual source scans over every file in `src/`, not a
lint rule scoped to an entry point, the properties hold for a file the
moment it is added to the tree — there is no opt-out short of editing the
allowlist array in the test itself. A refactor that moved a
platform-bound helper (SQLite, `@effected/xdg`, `std-env`'s `isAgent`)
into sdk would fail `sdk-boundaries` on the forbidden-import check the
moment the import statement lands, independent of whether that helper is
ever called. A refactor that added a `process.cwd()` read to an engine
service — for example, to shortcut passing `cwd` as an explicit
parameter — would fail `engine-boundaries` immediately, since engine's
rule carries no allowlist to hide behind; every ambient input engine
needs must arrive as a parameter from the front end that calls it. A
refactor that had `@vitest-agent/cli` import something from
`@vitest-agent/mcp` (or the reverse) to share a utility would fail the
corresponding forbidden-import check even without a manifest edge, and
the [ranked-layering](./ranked-layering.md) test's `sameLayer` check the
moment the edge lands in a `package.json` — the source-level and
manifest-level halves of the same prohibition. And moving a
`process.env` read for a new CLI subcommand into `lib/` instead of
`commands/`, or a new MCP tool's `process.env` mutation into a file other
than `tools/run-tests.ts`, would fail the corresponding allowlist check
even though the new code is otherwise correct.

The four tests do not check whether a *declared* dependency actually
gets used — see
[Invariant: Ranked layering](./ranked-layering.md) for the companion
manifest-level graph check the same #412 restructuring produced. Together
the two tests are what let [Decision 70](../decisions/70-carrier-pattern-and-ranked-layering.md)
and [Decision 71](../decisions/71-effect-native-mcp-server.md) claim the
platform-free core, the process-free engine, and the two front ends'
narrow entry contracts as properties of the tree rather than descriptions
of intent — see
[Convention: Front-end entry contract](../conventions/front-end-entry-contract.md)
for the `bin.ts` / `main.ts` / `index.ts` / `version.ts` split these
allowlists exist to protect.

[^sdk-boundaries]: `../../packages/sdk/__test__/boundaries.test.ts`
[^engine-boundaries]: `../../packages/engine/__test__/boundaries.test.ts`
[^cli-boundaries]: `../../packages/cli/__test__/boundaries.test.ts`
[^mcp-boundaries]: `../../packages/mcp/__test__/boundaries.test.ts`
