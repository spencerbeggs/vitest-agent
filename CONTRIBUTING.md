# Contributing to vitest-agent

Thank you for your interest in contributing! This document provides guidelines
and instructions for development.

## Prerequisites

- Node.js 22+ (the development environment uses 24.x; published
  packages declare `node >= 22`)
- pnpm 10+

## Development Setup

```bash
# Clone the repository
git clone https://github.com/spencerbeggs/vitest-agent.git
cd vitest-agent

# Install dependencies
pnpm install

# Build all outputs
pnpm run build

# Run tests
pnpm run test
```

## Project Structure

This is a pnpm monorepo with seven publishable packages under `packages/`
and a Claude Code plugin under `plugin/`.

```text
vitest-agent/
├── packages/
│   ├── plugin/                 # @vitest-agent/plugin (Vitest plugin + lifecycle)
│   │   └── src/
│   │       ├── index.ts            # Public API (AgentPlugin)
│   │       ├── reporter.ts         # Internal AgentReporter class
│   │       ├── plugin.ts           # AgentPlugin factory + namespace
│   │       └── layers/             # ReporterLive, CoverageAnalyzerLive
│   ├── reporter/               # @vitest-agent/reporter (named renderer factories)
│   │   └── src/
│   │       ├── index.ts            # Re-exports for named factories
│   │       └── *.ts                # defaultReporter, markdownReporter, etc.
│   ├── ui/                     # @vitest-agent/ui (event-sourced renderer)
│   │   └── src/
│   │       ├── index.ts            # renderRun, createLiveInk, eventSourcedReporter
│   │       ├── reducer.ts          # Pure (state, event) => state
│   │       ├── render-agent.ts     # Markdown-flavored final-frame string
│   │       ├── render-ink/         # React Ink components
│   │       ├── pubsub/             # RunEvent PubSub channel
│   │       └── factory/            # EventSourcedReporterFactory, LiveInkRenderer
│   ├── sdk/                    # @vitest-agent/sdk (data layer + services)
│   │   └── src/
│   │       ├── schemas/            # Effect Schema definitions (RunEvent, RenderState, ...)
│   │       ├── services/           # Effect Context.Tag definitions
│   │       ├── layers/             # Live + test layer implementations
│   │       ├── errors/             # Tagged error types
│   │       ├── formatters/         # markdown, gfm, json, silent
│   │       ├── migrations/         # SQLite migrations (0001_initial canonical)
│   │       ├── sql/                # Row types + assemblers
│   │       └── utils/              # Pure utilities
│   ├── cli/                    # @vitest-agent/cli (CLI bin)
│   │   └── src/
│   │       ├── bin.ts              # @effect/cli entry point
│   │       ├── commands/           # Thin command wrappers (status, show, ...)
│   │       └── lib/                # Testable formatting logic
│   ├── mcp/                    # @vitest-agent/mcp (MCP server bin)
│   │   └── src/
│   │       ├── server.ts           # @modelcontextprotocol/sdk server
│   │       ├── router.ts           # tRPC router (29 tools)
│   │       ├── context.ts          # ManagedRuntime context
│   │       └── tools/              # MCP tool implementations
│   ├── sidecar/                # @vitest-agent/sidecar (Node SEA inject-env binary)
│   └── sidecar-*/              # Prebuilt per-platform binaries (optionalDependencies)
├── plugin/                     # Claude Code plugin (NOT a pnpm workspace)
│   ├── .claude-plugin/plugin.json  # Manifest with inline mcpServers
│   ├── bin/start-mcp.sh            # PM-detect + exec loader (POSIX shell)
│   ├── hooks/                      # SessionStart, PreToolUse, PostToolUse, etc.
│   ├── skills/                     # tdd, debugging, configuration, coverage-improvement
│   └── commands/                   # setup, configure, tdd
├── website/                    # RSPress docs site (vitest-agent.dev)
├── playground/                 # Dogfooding sandbox (intentional defects)
├── docs/                       # Contributor docs (dogfooding) — user docs live on the site
├── lib/configs/                # Shared tool configuration
├── pnpm-workspace.yaml         # Workspace definitions
└── .claude/design/             # Architecture design documents
```

`@vitest-agent/sdk` is the dependency hub — `plugin`, `reporter`, `ui`,
`cli`, and `mcp` all import from it. The dependency flow is
`plugin → reporter → ui → sdk`. `@vitest-agent/plugin` declares
`@vitest-agent/cli` and `@vitest-agent/mcp` as required peer dependencies,
so a single install of the plugin pulls the whole family (including the
sidecar, which the CLI depends on) for end users.

## Architecture Patterns

### Effect Services

The project uses [Effect](https://effect.website/) for dependency injection
and service composition. Key patterns:

- **Services** (`packages/sdk/src/services/`) define interfaces via
  `Context.Tag`
- **Live layers** (`packages/sdk/src/layers/*Live.ts`) provide
  production implementations using `@effect/platform` for file I/O and
  `@effect/sql-sqlite-node` for the database
- **Test layers** (`packages/sdk/src/layers/*Test.ts`) provide mock
  implementations with state containers for assertions
- **Schemas** (`packages/sdk/src/schemas/`) use Effect Schema (not
  Zod) for data validation and serialization. Zod is used only inside
  `packages/mcp/` for tRPC procedure input schemas

### Reporter Integration

The `AgentReporter` class implements Vitest's Reporter interface. Each
lifecycle hook (`onTestRunEnd`) builds a scoped effect and runs it with
`Effect.runPromise`, providing the `ReporterLive` layer inline. This avoids
managed runtime lifecycle concerns.

### Pure Functions

Formatters (`packages/sdk/src/formatters/`) and small utilities
(`packages/sdk/src/utils/`) are plain functions, not Effect services.
They are trivially testable without layers.

## Available Scripts

| Script | Description |
| --- | --- |
| `pnpm run build` | Build dev + prod outputs via Turbo |
| `pnpm run test` | Run all tests |
| `pnpm run test:watch` | Run tests in watch mode |
| `pnpm run test:coverage` | Run tests with v8 coverage |
| `pnpm run lint` | Check code with Biome |
| `pnpm run lint:fix` | Auto-fix lint issues |
| `pnpm run lint:md` | Check markdown with markdownlint |
| `pnpm run lint:md:fix` | Auto-fix markdown issues |
| `pnpm run typecheck` | Type-check via Turbo (runs tsgo) |

## Code Quality

This project uses:

- **Biome** for linting and formatting (config in `biome.jsonc`)
- **Commitlint** for enforcing conventional commits with DCO signoff
- **Husky** for Git hooks
- **markdownlint** for markdown formatting

### Commit Format

All commits must follow
[Conventional Commits](https://conventionalcommits.org) and include a DCO
signoff:

```text
feat: add new formatter option

Signed-off-by: Your Name <your.email@example.com>
```

### Pre-commit Hooks

| Hook | Action |
| --- | --- |
| `pre-commit` | Runs lint-staged (Biome on staged files) |
| `commit-msg` | Validates commit message format via commitlint |
| `pre-push` | Runs tests for affected packages |

## Testing

Tests use [Vitest](https://vitest.dev) with v8 coverage and the `forks` pool.

```bash
# Run all tests
pnpm run test

# Run tests in watch mode
pnpm run test:watch

# Run tests with coverage
pnpm run test:coverage

# Run a specific test file
pnpm vitest run packages/sdk/src/utils/resolve-data-path.test.ts
```

### Testing Effect Services

The `@vitest-agent/sdk/testing` subpath provides `makeTestLayer` and five
preset factory functions for seeding representative database states. Import
from the subpath:

```typescript
import { Effect } from "effect";
import { DataReader } from "@vitest-agent/sdk";
import { singlePassingRun, withFailures } from "@vitest-agent/sdk/testing";

it("returns the latest run for a project", async () => {
  const layer = singlePassingRun(":memory:");
  const result = await Effect.runPromise(
    Effect.provide(
      Effect.flatMap(DataReader, (svc) => svc.getLatestRun("default", null)),
      layer,
    ),
  );
  expect(result?.reason).toBe("passed");
});
```

The preset factories cover the main database states out of the box:

| Factory | Seeded state |
| --- | --- |
| `empty(filename)` | Migrated database with no data |
| `singlePassingRun(filename)` | One passing run with three test cases |
| `withFailures(filename)` | One run with two failures and two passes |
| `flaky(filename)` | Two runs: first fails, second passes (same test) |
| `withTddSession(filename)` | A TDD session with one goal and two behaviors |

For tests that need custom data, use `makeTestLayer(":memory:")` and seed
the state directly via `DataStore`:

```typescript
import { Effect, Layer } from "effect";
import { DataStore } from "@vitest-agent/sdk";
import { makeTestLayer } from "@vitest-agent/sdk/testing";

const layer = makeTestLayer(":memory:");
const seed = Effect.gen(function* () {
  const store = yield* DataStore;
  yield* store.writeSettings("hash-1", { vitest_version: "4.1.5", pool: "forks" }, {});
  // ... write additional fixture data
});
const testLayer = Layer.effectDiscard(seed).pipe(Layer.provideMerge(layer));
```

CLI commands are thin wrappers -- logic lives in `cli/lib/` and is tested
as pure functions.

## TypeScript

- Extends `@savvy-web/rslib-builder/tsconfig/ecma/lib.json`
- Type-checking via `tsgo --noEmit`
- Strict mode with `exactOptionalPropertyTypes`

### Import Conventions

```typescript
// Use .js extensions for relative imports (ESM requirement)
import { resolveDataPath } from "./utils/resolve-data-path.js";

// Use node: protocol for Node.js built-ins
import { mkdir } from "node:fs/promises";

// Separate type imports
import type { AgentReport } from "./schemas/AgentReport.js";
```

## Working on the Claude Code plugin and MCP server

The Claude Code plugin at `plugin/` bootstraps the MCP server and delivers TDD skills, hooks and commands. Changes to this layer have different reload costs depending on what changed.

### How the MCP server process runs

Claude Code spawns the loader script as a direct child using the stdio transport. The MCP server communicates with CC over stdin/stdout — there is no HTTP or socket server. When you close a CC session, CC closes its end of the stdio pipe and the MCP server exits via EOF, leaving no orphan processes.

Claude Code sets `cwd` to the project root when it spawns the loader. `CLAUDE_PROJECT_DIR` is not passed to the loader process; both loaders resolve the project root from `process.cwd()` (Node.js) or `$(pwd)` (bash), which returns the correct directory because CC already set `cwd`.

### Loader strategy

The plugin ships two loader scripts in `plugin/bin/`:

- `start-mcp.sh` — a POSIX shell script that uses `exec` to replace itself with the package manager command. After startup, CC's direct child is the package-manager process with no shell wrapper remaining. Total live processes: 2 (package manager + MCP server).
- `start-mcp.mjs` — a Node.js wrapper that spawns the package manager via `child_process.spawn` with `stdio: 'inherit'`. The wrapper stays alive to forward exit codes and print install instructions on failure. Total live processes: 3 (node wrapper + package manager + MCP server).

`plugin.json` controls which loader CC uses via `mcpServers.command` and `mcpServers.args`. Note that `pnpm exec` forks the MCP server rather than exec-ing into it, so it stays alive as an intermediate process regardless of which loader is used.

### Hot-reload cost matrix

| What changed | Action required |
| --- | --- |
| Hook script body (`.sh`) | None — takes effect on next hook invocation |
| Skill or agent markdown | None — takes effect on next subagent dispatch |
| Plugin allowlist (`safe-mcp-vitest-agent-ops.txt`) | None — takes effect on next tool call |
| MCP server or SDK source (`packages/mcp/`, `packages/sdk/`) | `pnpm ci:build` + `/reload-plugins` |
| Database migration | `pnpm ci:build` + delete `data.db` + `/reload-plugins` |
| `hooks.json` (new entry or matcher) | `/reload-plugins` only — hook registrations reload with the plugin |
| `plugin.json` `mcpServers.<server>.args` | `/reload-plugins` only — changing `args` restarts that MCP server |
| `plugin.json` other fields (new servers, metadata) | Full CC restart — `/reload-plugins` is not sufficient |

### Triggering an MCP restart without a full CC restart

`/reload-plugins` only restarts the MCP server when `plugin.json`'s `command` or `args` field changes. A reload with no manifest change leaves the running MCP process untouched.

After rebuilding (`pnpm ci:build`), bump the `--noop` counter in `plugin.json`'s `mcpServers.mcp.args` to force a restart on the next `/reload-plugins`:

```json
{
  "mcpServers": {
    "mcp": {
      "command": "bash",
      "args": ["${CLAUDE_PLUGIN_ROOT}/bin/start-mcp.sh", "--noop=2"]
    }
  }
}
```

The `--noop` arg is forwarded to the MCP binary, which ignores unknown flags, so it is a harmless signal for Claude Code only. `--noop=1` is the committed baseline and stays in the file permanently — changing the value is what cues Claude Code to boot a fresh MCP instance on `/reload-plugins`. After confirming the restart, revert the value back to `--noop=1` before pushing.

### Confirming an MCP restart

Check that process IDs changed after a reload:

```bash
ps aux | grep -E "start-mcp|vitest-agent-mcp" | grep -v grep | awk '{print $2, $11, $12, $13}'
```

If the PIDs match what you saw before the reload, the manifest did not change and the MCP server was not restarted.

## Submitting Changes

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes following TDD (write tests first)
4. Run tests: `pnpm run test`
5. Run linting: `pnpm run lint:fix`
6. Run typecheck: `pnpm run typecheck`
7. Commit with conventional format and DCO signoff
8. Push and open a pull request

## License

By contributing, you agree that your contributions will be licensed under the
MIT License.
