---
"@vitest-agent/ui": major
---

## Features

The Ink components now honour a consumer's token overrides: colours resolve against the theme of the mounted screen instead of the default palette.

## Breaking Changes

Elements returned by `dispatchInk` and `inkDispatcherTable` must now be drawn under a `UiProvider` from `@effected/cli-kit/ui`. A self-mounted tree already needed one, so only code that renders these elements into its own tree is affected.

## Other

Deprecated: `inkStyle` and `statusInkStyle` are deprecated. Their signatures and behaviour are unchanged, but they see only the default palette. In a component, use `useStyle` or `Styled` from `@effected/cli-kit/ui`.
