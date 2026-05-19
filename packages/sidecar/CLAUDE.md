# vitest-agent-sidecar

The seventh publishable workspace. Sole responsibility: ship a fast-path native binary for the `inject-env` operation on the per-Bash-call PreToolUse hot path, and export `resolveSidecarBinaryPath` so callers can find that binary at runtime.

**Internal dependencies:** none (the parent package has no runtime workspace deps). `vitest-agent-cli` depends on `vitest-agent-sidecar` — not the reverse.

## Layout

```text
src/
  index.ts                      -- rslib entry: re-exports resolveSidecarBinaryPath
  resolve-sidecar-binary-path.ts -- resolves the SEA binary path via
                                    createRequire(import.meta.url).resolve;
                                    must live here so require.resolve finds the
                                    optionalDependencies declared in this package
__test__/                       -- unit tests for the resolver (dependency injection
                                    via options.resolver; no real binary required)
```

The per-platform SEA binaries ship in four sibling child packages (`vitest-agent-sidecar-{darwin-arm64,linux-arm64,linux-x64,win32-x64}`) listed as `optionalDependencies`. Each child declares the binary as its own `bin` entry; pnpm installs only the matching one based on `os`/`cpu` fields. Each child's `src/bin.ts` imports `dispatch` from `vitest-agent-sdk/dispatch` — `vitest-agent-sdk` is the sole workspace devDependency bundled into the SEA.

## Key API

`resolveSidecarBinaryPath(options?)` — returns the absolute path of the installed platform binary, or `null` when the platform is unsupported or the optional dep was not installed. Uses `require.resolve` (not PATH) because pnpm/npm never hoist transitive optional-dependency bins into `node_modules/.bin/`. The resolver anchor (`import.meta.url`) **must** sit inside this package, which is why the resolver cannot be moved to `vitest-agent-cli` or any other package.

## How the binary path reaches the hook

1. `vitest-agent agent sidecar-path` (a CLI subcommand) calls `resolveSidecarBinaryPath()` and prints the result to stdout.
2. The SessionStart hook (`plugin/hooks/session/start.sh`) runs this subcommand once per session and exports `VITEST_AGENT_SIDECAR_BIN=<abs-path>` to both `CLAUDE_ENV_FILE` and the per-session env file.
3. The PreToolUse Bash hook Layer 2 reads `$VITEST_AGENT_SIDECAR_BIN` and execs the binary directly — no PM wrapper, no Node cold-start.

## Conventions

- **No runtime workspace deps.** The parent `packages/sidecar/` has zero workspace runtime dependencies. `vitest-agent-sdk` is the only workspace devDependency of the per-platform child packages — each child's `src/bin.ts` does `import { dispatch } from "vitest-agent-sdk/dispatch"`, bundled into the SEA at build time. The children no longer devDepend on `vitest-agent-cli`.
- **`packages/sidecar/turbo.json` has no `dependsOn` override.** With the dispatch core moved into `vitest-agent-sdk`, the old `cli → sidecar → sidecar-<platform> → cli` cycle is gone, so the parent sidecar build inherits the normal `^build` topological ordering (`build:dev` uses `["^build:dev"]`, `build:prod` uses `["^build:prod"]`).
- **Building.** The parent package builds with rslib-builder. The per-platform children build with tsdown's `exe` mode (Node SEA) via `lib/scripts/tsdown.ts`. Use `turbo run build:dev build:prod --filter='./packages/sidecar'` to build the parent.

## When working in this package

- Do not add workspace runtime dependencies to the parent `packages/sidecar/`. The resolver function must remain self-contained.
- To add a new supported platform, add an entry to `SUPPORTED_PLATFORMS` in `resolve-sidecar-binary-path.ts` and create the matching `packages/sidecar-<platform>/` child package following the existing child layout.
- Tests for the resolver use `options.resolver` injection — pass a stub that returns a path or throws `MODULE_NOT_FOUND` without touching the real package graph.
- If `resolveSidecarBinaryPath` needs to move logic, keep its anchor inside this package: `createRequire(import.meta.url)` only resolves `optionalDependencies` declared in `vitest-agent-sidecar`'s own `package.json`.

## Design references

- `@./.claude/design/vitest-agent/components/sidecar.md`
  Load when working on the build pipeline, per-platform child layout, SEA build process, hook integration, or distribution model.
- `@./.claude/design/vitest-agent/decisions.md`
  Load for Decision 42 (sidecar env-var resolution approach, dependency inversion rationale).
