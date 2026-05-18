---
"vitest-agent-sidecar": minor
---

## Features

### `resolveSidecarBinaryPath` — runtime binary resolver

`vitest-agent-sidecar` now exports `resolveSidecarBinaryPath(options?)` and the companion `ResolveSidecarBinaryPathOptions` type. The function returns the absolute path of the installed per-platform SEA binary, or `null` when the platform is unsupported or the optional dependency was not installed.

The resolver anchors its `require.resolve` call inside `vitest-agent-sidecar` — the package that declares the four per-platform packages as `optionalDependencies`. This is the only location from which `require.resolve` can find those packages; callers that import the function do not need to replicate the resolution logic.

```ts
import { resolveSidecarBinaryPath } from "vitest-agent-sidecar";

const bin = resolveSidecarBinaryPath();
if (bin !== null) {
  // exec bin directly — no Node cold-start, no PATH lookup
}
```

### Removed re-exports from `vitest-agent-cli`

The prior `dispatch` and `injectEnv` re-exports (which forwarded to `vitest-agent-cli`) are gone. The package's runtime dependency on `vitest-agent-cli` is removed. `vitest-agent-sidecar` now has zero runtime workspace dependencies.
