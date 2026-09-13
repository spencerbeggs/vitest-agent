---
"@vitest-agent/sdk": major
---

## Breaking Changes

`@vitest-agent/sdk` is now the platform-free core of the family: Effect Schemas, the public reporter and dispatcher contracts, tagged errors, pure formatters and utils, the pure `./dispatch` entry, and `./schemas/*.json`. It has no workspace dependencies and no `node:` imports; its only runtime dependencies are `effect`, `acorn`, and `acorn-typescript`.

### Platform code moved to `@vitest-agent/engine`

Everything that touched SQLite, the filesystem, or the environment now lives in the new `@vitest-agent/engine` package. Import it from there:

- `services/*` (`DataStore`, `DataReader`, `Config`, `RunContext`, `ProjectIdentity`, `HistoryTracker`, and the rest) and every `*Live` / `*Test` layer under `layers/*`
- `sql/*`, `migrations/*`, and the `./testing` subpath (`makeTestLayer`, the preset factories)
- `formatTriageEffect` and `formatWrapupEffect`
- `resolveDataPath`, `ensureMigrated`, `resolveWorkspaceKey`, `resolveProjectKeyFromCwd`, `computeFailureSignature`, `deriveIdempotencyKey`

```ts
// before
import { DataStore, makeTestLayer } from "@vitest-agent/sdk";
import { resolveDataPath } from "@vitest-agent/sdk";

// after
import { DataStore, resolveDataPath } from "@vitest-agent/engine";
import { makeTestLayer } from "@vitest-agent/engine/testing";
```

### `dispatch` and `injectEnv` take an explicit I/O object

The pure `./dispatch` entry no longer reads `process`. Pass the working directory, environment, and a synchronous file reader:

```ts
import { readFileSync } from "node:fs";
import { dispatch } from "@vitest-agent/sdk/dispatch";

const result = await dispatch(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  readFile: (path) => readFileSync(path, "utf-8"),
});
```

`injectEnv` accepts the same `{ cwd, env, readFile }` shape.

### Formatter context and path helpers

- `FormatterContext` gains a required `cwd` field — the absolute project root the run executed from.
- `relativePath(filePath, cwd)` now requires `cwd` as its second argument.
- `suggestedPath` from `test-location` returns `/`-separated paths on every platform.

`CURRENT_SDK_VERSION` is unchanged.
