---
"@vitest-agent/cli": major
---

## Breaking Changes

### Effect v4 + `effect/unstable/cli`

`@effect/cli` is replaced by the in-core `effect/unstable/cli`. If anything scripts against `@vitest-agent/cli`'s internal Effect Cli constructs: `Options` is now `Flag`, `Args` is now `Argument`, and `ValidationError` is now `CliError`. `Command.run` no longer accepts a `name` option and reads `argv` from the `Stdio` service instead of taking it as an argument.

The three-command tree (`doctor`, `db`, `agent`) and the exit-code contract of the `vitest-agent` binary itself are unchanged — this is an internal Effect API shape change, not a behavior change to the CLI's shell interface.

## Dependencies

| Dependency            | Type       | Action  | From    | To            |
| :--------------------- | :--------- | :------ | :------ | :------------ |
| @effect/cli            | dependency | removed | 0.75.2  | —              |
| @effect/cluster        | dependency | removed | 0.59.0  | —              |
| @effect/experimental   | dependency | removed | 0.60.0  | —              |
| @effect/platform       | dependency | removed | 0.96.3  | —              |
| @effect/platform-node  | dependency | updated | 0.107.0 | 4.0.0-beta.98  |
| @effect/printer        | dependency | removed | 0.49.0  | —              |
| @effect/printer-ansi   | dependency | removed | 0.49.0  | —              |
| @effect/rpc            | dependency | removed | 0.75.1  | —              |
| @effect/sql            | dependency | removed | 0.51.1  | —              |
| @effect/sql-sqlite-node| dependency | updated | 0.52.0  | 4.0.0-beta.98  |
| @effect/typeclass      | dependency | removed | 0.40.0  | —              |
| @effect/workflow       | dependency | removed | 0.18.2  | —              |
| effect                 | dependency | updated | 3.22.0  | 4.0.0-beta.98  |
