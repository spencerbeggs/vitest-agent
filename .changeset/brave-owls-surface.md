---
"@vitest-agent/ui": major
---

## Breaking Changes

### Effect v4

`@vitest-agent/ui` now runs on Effect v4 (`effect@4.0.0-beta.98`).

### PubSub subscription API

`subscribeRaw()` now returns `PubSub.Subscription<RunEvent>` instead of `Queue.Dequeue<RunEvent>` — Effect v4 replaces `Queue.take` with `PubSub.take` for pub/sub consumers. `renderStateStream()` no longer requires `Scope.Scope` in its effect context; the scope is now managed internally by `Stream.fromPubSub`.

`RunEventChannel` is now declared via `Context.Service` instead of `Context.Tag`, and `RunEventChannelLive` uses `Layer.effect` instead of `Layer.scoped`. Consumers of the exported layer are unaffected; anyone constructing the tag shape directly should check `Context.Service`'s API.

## Features

* `synthesizeFromAgentReport` now surfaces suite-level (collection/load) failures in the synthesized event stream: a module that fails to import gets a synthetic failed test (new `SUITE_LOAD_FAILURE_LABEL` export) carrying the import error, so it shows up in the Failures detail instead of being silently dropped.

## Dependencies

| Dependency | Type       | Action  | From   | To            |
| :---------- | :--------- | :------ | :----- | :------------ |
| effect      | dependency | updated | 3.22.0 | 4.0.0-beta.98 |
