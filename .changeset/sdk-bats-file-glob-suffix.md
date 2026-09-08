---
"@vitest-agent/sdk": minor
---

## Features

* Added `BATS_FILE_GLOB_SUFFIX` (`"*.bats"`) to `utils/test-location.ts`,
  alongside `TEST_FILE_GLOB_SUFFIX`, as the single source of truth for
  the Bats shell test file naming convention. Consumed by
  `@vitest-agent/plugin`'s `isTestShapedPackage` so a package whose
  tests are Bats-only no longer trips the declined-package warning.
