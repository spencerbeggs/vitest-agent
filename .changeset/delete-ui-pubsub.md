---
"@vitest-agent/ui": major
---

## Breaking Changes

Removed the unused `RunEventChannel` PubSub module from `@vitest-agent/ui`: `RunEventChannel`, `RunEventChannelLive`, `publish`, `publishAll`, `subscribeRaw`, `accumulateUntilFinished`, `forEachRenderState` and `renderStateStream`. Nothing in the family called them. The plugin owns the run-event `PubSub` on `ReporterKit.runEvents`, and the `stream` live view subscribes to it through `CliUi.live`. A custom reporter subscribes to `ReporterKit.runEvents` directly and folds events with `reduceRenderState`.
