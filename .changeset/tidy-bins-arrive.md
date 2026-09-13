---
"@vitest-agent/plugin": minor
---

## Features

### The plugin ships both bins

`@vitest-agent/plugin` now declares the `vitest-agent` and `vitest-agent-mcp` bins itself, as thin shims over `@vitest-agent/cli/main` and `@vitest-agent/mcp/main`. Installing the plugin alone puts both commands in `node_modules/.bin` under npm, pnpm, yarn, and bun — no hoisting configuration, package-manager plugin, or extra devDependency is required.

```jsonc
// package.json — this is all a consumer needs
{ "devDependencies": { "@vitest-agent/plugin": "^3.1.0" } }
```

```sh
npx vitest-agent doctor
npx vitest-agent-mcp
```

`@vitest-agent/cli` and `@vitest-agent/mcp` are regular exact-pinned dependencies of the plugin, and the plugin now depends on `@vitest-agent/engine` for its platform layer.
