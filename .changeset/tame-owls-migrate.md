---
"@vitest-agent/sdk": major
---

## Breaking Changes

`RUN_REPORT_FILE_SCHEMA_URL` now points at a GitHub-hosted document instead of the never-live `vitest-agent.dev` URL:

```ts
import { RUN_REPORT_FILE_SCHEMA_URL } from "@vitest-agent/sdk";

// Before
// "https://vitest-agent.dev/schemas/run-report-file-1.0.0.json"

// After
console.log(RUN_REPORT_FILE_SCHEMA_URL);
// "https://raw.githubusercontent.com/spencerbeggs/vitest-agent/main/schemas/5.0/run.json"
```

Every `run.json` file the reporter writes now stamps this new URL as its `$schema` value. The published schema document also moved on disk, so the `./schemas/*.json` subpath export resolves a new file:

```ts
// Before
require.resolve("@vitest-agent/sdk/schemas/run-report-file-1.0.0.json");

// After
require.resolve("@vitest-agent/sdk/schemas/5.0/run.json");
```

Anyone who imported the old subpath directly, or validated `run.json` against the old URL, needs to update to the new path and URL.
