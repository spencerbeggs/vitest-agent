---
name: test-discovery
description: Explains the prescribed __test__/ directory layout, test file naming conventions, and how source coverage is derived from the adjacent src/ folder.
paths:
  - "**/__test__/**/*"
  - "**/__fixtures__/**/*"
  - "**/__snapshots__/**/*"
---

# Test Layout — `__test__/` Conventions

Projects using this layout place tests in a `__test__/` directory that sits adjacent to `src/`. Coverage is calculated from that `src/` directory. Auto-discovery tools (like `AgentPlugin.discover()`) may generate Vitest projects from this structure automatically, but custom project configurations are also possible.

```text
<project-root>/
├── src/            source code — coverage is calculated from here
└── __test__/       tests and test support files
```

## `__test__/` Directory Structure

Test files sit flat at the top level of `__test__/`; helper files go in reserved subdirectories organised by test kind.

```text
__test__/
├── *.test.ts | *.test.unit                   unit test files
├── fixtures/                   static files needed by unit tests
├── snapshots/                  Vitest snapshot files for unit tests
├── utils/                      shared helpers for unit tests
├── integration/
│   ├── *.int.test.ts           integration test files
│   ├── fixtures/               static files needed by integration tests
│   ├── snapshots/              Vitest snapshot files for integration tests
│   └── utils/                  shared helpers for integration tests
└── e2e/
    ├── *.e2e.test.ts           e2e test files
    ├── fixtures/               static files needed by e2e tests
    ├── snapshots/              Vitest snapshot files for e2e tests
    └── utils/                  shared helpers for e2e tests
```

## Subdirectory Rules

| Subdirectory | Coverage | Lint | Typecheck | Purpose |
| --- | :---: | :---: | :---: | --- |
| `fixtures/` | excluded | excluded | excluded | Static files consumed by tests (JSON, TOML, binary, etc.) |
| `snapshots/` | excluded | excluded | excluded | Vitest snapshot output (managed automatically) |
| `utils/` | excluded | required | required | Shared helpers — mocks, extended `expect`, shared types |

Fixtures and snapshots are fully excluded; place arbitrary static content there without concern for linting or types. Utils files must be valid TypeScript and pass the linter — treat them as first-class support code, just not counted toward coverage.

## Escape Hatch — `__fixtures__` and `__snapshots__` Anywhere

Directories named `__fixtures__` or `__snapshots__` (double-underscore wrapping) are recognised and excluded from coverage, linting, and typechecking wherever they appear inside a project — not just under `__test__/`. This can be useful when a fixture needs to live close to the source file it supports.

Prefer the prescribed locations (`__test__/fixtures/`, `__test__/integration/fixtures/`, etc.) over this escape hatch. Scattering `__fixtures__` directories through `src/` makes test support files harder to find and the project harder to navigate.

## Test File Classification

The scanner classifies files by suffix; first match wins:

| Suffix | Kind | Lives in |
| --- | --- | --- |
| `*.e2e.test.ts` | e2e | `__test__/e2e/` |
| `*.int.test.ts` | int | `__test__/integration/` |
| `*.test.ts` or `*.unit.test.ts` | unit | `__test__/` (top level) |
