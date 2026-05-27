---
"vitest-agent-plugin": minor
---

## Features

All seven published packages now expose a `./package.json` subpath export, making the package version and metadata directly importable without bundler hacks or `require.resolve` workarounds.

```ts
import pkg from "vitest-agent-plugin/package.json" assert { type: "json" };
console.log(pkg.version);
```

The same export is available on `vitest-agent-sdk`, `vitest-agent-reporter`,
`vitest-agent-ui`, `vitest-agent-cli`, `vitest-agent-mcp`, and
`vitest-agent-sidecar`.
