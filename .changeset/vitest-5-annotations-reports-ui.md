---
"@vitest-agent/ui": minor
---

## Features

The `TestAnnotated` and `TestArtifactRecorded` run events now carry the annotation type, source location, and attachment descriptors, matching the wider events the plugin and reporter now emit. Both remain no-ops in the reducer.
