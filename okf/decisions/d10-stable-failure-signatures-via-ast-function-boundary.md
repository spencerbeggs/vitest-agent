---
type: Decision
title: Stable Failure Signatures via AST Function Boundary
description: A failure signature hashes the error name, a type-tag-normalized assertion shape, and the AST-derived start line of the smallest enclosing function, so it survives reformatting, comment edits, and literal-value churn while still distinguishing structurally different failures.
status: stable
tags:
  - architecture
  - testing
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: f2678b476d369fca8d2807b271f63723b723e56aba033413e75c6b17a7a24043
sources:
  - id: failure-signature
    resource: ../../packages/engine/src/utils/failure-signature.ts
  - id: function-boundary
    resource: ../../packages/sdk/src/utils/function-boundary.ts
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Stable Failure Signatures via AST Function Boundary

## Context

Classifying a test failure as `new-failure`, `persistent`, `flaky`, or
`recovered` across runs requires a stable identifier for "this failure" that
survives incidental source edits between runs but still distinguishes
genuinely different failure shapes.

## Decision

`computeFailureSignature` in `packages/engine/src/utils/failure-signature.ts`
builds a `|`-joined key from four parts — the error name, a normalized
assertion shape, the top non-framework function's name, and a spatial
coordinate — and hashes it with `sha256`, truncated to a 16-character hex
prefix.[^failure-signature]

The spatial coordinate is the function-boundary line, not the raw failing
line. `findFunctionBoundary` in `packages/sdk/src/utils/function-boundary.ts`
parses the source with `acorn`, extended via `Parser.extend(tsPlugin())` from
`acorn-typescript` so TypeScript sources with type annotations, generics,
decorators, and `as` casts parse without throwing, and walks the resulting
AST for the smallest enclosing `FunctionDeclaration` / `FunctionExpression` /
`ArrowFunctionExpression` whose `loc` range contains the failing line. The
function's own start line — not the failing statement's line — becomes the
coordinate, and the function's name is resolved from its own `id`, or from
the parent `VariableDeclarator`'s id for an anonymous function assigned to a
binding, or from the parent `MethodDefinition`'s key for a class
method.[^function-boundary] When `top_frame_function_boundary_line` is
`null` (a parse error, or a failing line outside any function),
`computeFailureSignature` falls back to a coarser
`raw:<floor(line/10)*10>` bucket from `top_frame_raw_line`, and to the fixed
literal `raw:?` when even that is absent — deliberately collapsing every such
failure to one signature for lack of a better discriminator.[^failure-signature]

The assertion shape is normalized before hashing: `normalizeAssertionShape`
matches one of a fixed set of Vitest matcher names against the message and
replaces its argument with a type tag (`<number>`, `<string>`, `<boolean>`,
`<null>`, `<undefined>`, `<object>`, or `<expr>` for anything else), so
`expect(42).toBe(43)` and `expect(7).toBe(8)` produce the same shape while
`toBe(<number>)` and `toBe(<string>)` remain distinct.[^failure-signature]

## Alternatives rejected

- **Hash the raw failing line number.** Rejected because insertions,
  deletions, comment edits, and formatter changes anywhere before the
  failing line shift it even when the failure itself is unchanged, making
  every incidental edit look like a new failure.
- **Hash the raw assertion message verbatim.** Rejected because literal
  values in the message (`43` vs `44`) would churn the signature on every
  run with different test data despite being the same structural failure.
- **A regex or text-based heuristic for locating the enclosing function**
  instead of a real parse. Rejected because it would be defeated by
  whitespace-only reformatting and nested-function ambiguity that a real AST
  walk resolves unambiguously via `loc` ranges.

## Consequences

Re-parsing the source file on every signature computation is moderately
expensive (microseconds per parse), but the cost is bounded by failure
count, not assertion count, so it has not warranted caching by
`(file, mtime)`. The boundary line does shift when the function definition
itself moves — for example when a new function is inserted before it — and
that is treated as correct behavior: the failure is now structurally located
somewhere different in the file, so a new signature is the honest outcome,
not a bug to work around.

## Related

- [Module: engine](../modules/engine.md)
- [Module: sdk](../modules/sdk.md)

[^failure-signature]: `../../packages/engine/src/utils/failure-signature.ts`
[^function-boundary]: `../../packages/sdk/src/utils/function-boundary.ts`
