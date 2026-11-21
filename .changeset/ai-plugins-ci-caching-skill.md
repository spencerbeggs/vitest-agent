---
"@vitest-agent/ai-plugins": minor
---

## Features

- New `ci-caching` skill: how to keep Vitest 5's fs module cache warm in GitHub Actions. It covers moving the cache out of `node_modules` with `VITEST_FS_MODULE_CACHE_PATH`, a rotating `actions/cache` key (a per-run key restored by an OS-plus-lockfile prefix) so the entry keeps learning instead of freezing at its first save, a size cap, restoring but never saving on untrusted fork runs, and measuring cold against warm. It also explains how vitest-agent's tag cache-key generator keeps restored entries correct, and how the same pattern applies to other caches that grow.
