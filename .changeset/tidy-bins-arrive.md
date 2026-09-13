---
"@vitest-agent/plugin": major
---

## Breaking Changes

### `ReporterLive` takes a single options object

The public `ReporterLive` layer factory now forwards one `PlatformOptions` object to the engine's `PlatformLive` instead of positional arguments. `env` is required (the reporter passes `process.env`), so the platform layer no longer reads the process environment on its own.

```ts
// before
ReporterLive(dbPath, logLevel, logFile);

// after
ReporterLive({ dbPath, env: process.env, logLevel, logFile });
```

`dbPath` is the absolute path to the per-project `data.db` (or `":memory:"`); `logLevel` and `logFile` stay optional.

### The plugin carries the new CLI and MCP majors

`@vitest-agent/plugin` now exact-pins `@vitest-agent/cli` 3.x and `@vitest-agent/mcp` 4.x, both of which are major releases (the utility-only three-command CLI and the Effect-native action-keyed MCP server). Upgrading the plugin upgrades both bins at once; read those packages' release notes for the renamed commands and tools.

## Features

### The plugin ships both bins

`@vitest-agent/plugin` now declares the `vitest-agent` and `vitest-agent-mcp` bins itself, as thin shims over `@vitest-agent/cli/main` and `@vitest-agent/mcp/main`. Installing the plugin alone puts both commands in `node_modules/.bin` under npm, pnpm, yarn, and bun — no hoisting configuration, package-manager plugin, or extra devDependency is required.

```jsonc
// package.json — this is all a consumer needs
{ "devDependencies": { "@vitest-agent/plugin": "^4.0.0" } }
```

```sh
npx vitest-agent doctor
npx vitest-agent-mcp
```

`@vitest-agent/cli` and `@vitest-agent/mcp` are regular exact-pinned dependencies of the plugin, and the plugin now depends on `@vitest-agent/engine` for its platform layer.
