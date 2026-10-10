---
type: Decision
title: Hook Responses Through the pluginfinity Hook Library
description: Every hook answers exactly once through the pluginfinity hook library's response functions, and every CLI call captures or redirects its stdout; a bats suite that runs every hook against a stdout-spamming CLI replaces the old fd-3 stdout fence.
status: stable
supersedes: d23-fence-hook-stdout-at-the-library-not-the-call-site.md
tags:
  - dx
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-10-10T02:40:34Z
  body_sha256: 01f53eca93063d11d95fd572039ab9e56355a4d52bb31a025bbfa7ed29716ecc
sources:
  - id: hook-output-bats
    resource: ../../plugin/__test__/hook-output.bats
  - id: plugin-claude-md
    resource: ../../plugin/CLAUDE.md
  - id: test-run-sh
    resource: ../../plugin/hooks/post-tool-use/test-run.sh
verified:
  - by: human:spencer
    at: 2026-10-10T02:23:56Z
---

# Hook Responses Through the pluginfinity Hook Library

## Context

A host parses a hook's stdout as one JSON object, so a stray byte from a
spawned CLI corrupts the whole response and the host discards it,
permission decision included (issue 373). [Decision
D23](d23-fence-hook-stdout-at-the-library-not-the-call-site.md) made that
unrepresentable with a fence in the vendored `hooks/lib/hook-output.sh`:
`exec 3>&1 1>&2` at source time, with every `emit_*` helper writing to fd
3. The pluginfinity migration ([Decision
80](80-build-the-agent-plugin-from-one-pluginfinity-source.md)) removed
the vendored library. Responses now come from pluginfinity's generated
`hook.sh`, which writes to stdout and translates the response for each
host.

## Decision

Every hook sources pluginfinity's `hook.sh`, then
`lib/vitest-agent/common.sh`, calls `hook_require_input`, reads its payload
only through `hook_input`, and answers exactly once with `hook_noop`,
`hook_context`, `hook_deny`, `hook_allow`, `hook_system_message`, or
`hook_raw`.[^plugin-claude-md] There is no stdout fence. Each CLI call must
capture its output (`$(...)`) or redirect it (`>/dev/null 2>&1`) at the
call site, as `post-tool-use/test-run.sh` does on its `record`
calls.[^test-run-sh] The guard moved from construction to a test:
`__test__/hook-output.bats` runs every hook against a stub CLI that spams
stdout and fails if anything leaks into the response.[^hook-output-bats]
The suite runs against both builds.

## Alternatives rejected

- **Re-add an fd-3 fence on top of the library.** Rejected: the library
  owns the response write and its host translation, and a second fence
  would have to wrap a generated file this repository does not edit.
- **Keep the vendored `emit_*` helpers.** Rejected for the same reason the
  migration exists: those helpers spoke Claude Code's response shape only.

## Consequences

- Correctness again rests on each call site, but a leak fails the bats
  suite rather than reaching a host. A new hook needs no new test to be
  covered, because the suite iterates every hook.
- Never fold stderr into a capture that `jq` parses (`2>&1`): a package
  manager's config warning on stderr corrupts the JSON
  (`__test__/sidecar-env-warn.bats`).
- The `SessionEnd` detach no longer needs the `3>&-` close D23 required;
  the shim redirects every descriptor of the detached worker.

## Related

- [Module: vitest-agent agent plugin](../modules/claude-code-plugin.md)

[^hook-output-bats]: `../../plugin/__test__/hook-output.bats`
[^plugin-claude-md]: `../../plugin/CLAUDE.md`
[^test-run-sh]: `../../plugin/hooks/post-tool-use/test-run.sh`
