---
"@vitest-agent/ui": minor
---

## Features

* Dispatcher cells accept `CellOptions.link` to emit file links
* `@vitest-agent/ui/ink` exports `FileLink`, `FileLinkProvider`, `FileLinkProviderProps` and `useFileLink` for Ink renderers
* `formatSuggestedActionLines` renders suggested actions, and the reducer folds console leaks into render state so every cell shows them
