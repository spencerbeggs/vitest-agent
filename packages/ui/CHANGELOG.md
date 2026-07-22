# @vitest-agent/ui

## 2.0.5

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.0.4 | 2.0.5 |

## 2.0.4

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.0.3 | 2.0.4 |

## 2.0.3

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.0.2 | 2.0.3 |

## 2.0.2

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.0.1 | 2.0.2 |

* | Dependency | Type       | Action  | From          | To            |                                                          |
  | ---------- | ---------- | ------- | ------------- | ------------- | -------------------------------------------------------- |
  | effect     | dependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

## 2.0.1

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.0.0 | 2.0.1 |

## 2.0.0

### Breaking Changes

* ### Effect v4

  `@vitest-agent/ui` now runs on Effect v4 (`effect@4.0.0-beta.98`).

  ### PubSub subscription API

  `subscribeRaw()` now returns `PubSub.Subscription<RunEvent>` instead of `Queue.Dequeue<RunEvent>` — Effect v4 replaces `Queue.take` with `PubSub.take` for pub/sub consumers. `renderStateStream()` no longer requires `Scope.Scope` in its effect context; the scope is now managed internally by `Stream.fromPubSub`.

  `RunEventChannel` is now declared via `Context.Service` instead of `Context.Tag`, and `RunEventChannelLive` uses `Layer.effect` instead of `Layer.scoped`. Consumers of the exported layer are unaffected; anyone constructing the tag shape directly should check `Context.Service`'s API.

### Features

* `synthesizeFromAgentReport` now surfaces suite-level (collection/load) failures in the synthesized event stream: a module that fails to import gets a synthetic failed test (new `SUITE_LOAD_FAILURE_LABEL` export) carrying the import error, so it shows up in the Failures detail instead of being silently dropped.

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 1.3.4 | 2.0.0 |

* | Dependency | Type       | Action  | From   | To            |                                                                       |
  | :--------- | :--------- | :------ | :----- | :------------ | --------------------------------------------------------------------- |
  | effect     | dependency | updated | 3.22.0 | 4.0.0-beta.98 | [#161][#161] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#161]: https://github.com/spencerbeggs/vitest-agent/pull/161

## 1.1.2

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 1.3.3 | 1.3.4 |

## 1.1.1

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 1.3.2 | 1.3.3 |

## 1.1.0

### Features

* The stream console view now aligns every aggregate row into fixed columns: pass/fail/skip/timeout counts render right-aligned in 4-digit cells with dimmed zeros, and durations render right-aligned in a fixed 7-character cell.
* Tag counts render as true columns via the new `TagColumns` component and `tagUnion` helper: every row shows every tag in the view-level union with dimmed zeros, and a view whose union is a single tag shows no tag columns at all. This replaces the old sparse per-row tag suffix.
* The workspace `Total:` line pads its label so its count columns sit directly under the project rows.
* New public exports: `TagColumns`, `TagColumnsProps`, `tagUnion`, and `DURATION_CELL_WIDTH`. [#128][#128]

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 1.3.1 | 1.3.2 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#128]: https://github.com/spencerbeggs/vitest-agent/pull/128

## 1.0.5

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 1.3.0 | 1.3.1 |

## 1.0.4

### Patch Changes

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 1.2.0 | 1.3.0 |

## 1.0.3

### Patch Changes

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 1.1.0 | 1.2.0 |

## 1.0.2

### Dependencies

* [`3e0cfe3`](https://github.com/spencerbeggs/vitest-agent/commit/3e0cfe38157ef21bfe1d817f557914ce79a43885) | Dependency | Type | Action | From | To |
  \| ------------------ | ------------- | ------- | ------- | ------ |
  \| @savvy-web/bundler | devDependency | updated | ^0.11.1 | ^1.0.1 |
  | Dependency        | Type       | Action  | From  | To    |
  | ----------------- | ---------- | ------- | ----- | ----- |
  | @vitest-agent/sdk | dependency | updated | 1.0.1 | 1.1.0 |

## 1.0.1

### Patch Changes

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 1.0.0 | 1.0.1 |

## 1.0.0

### Features

* [`e509228`](https://github.com/spencerbeggs/vitest-agent/commit/e5092289c0f64446dddc8ad0abc25856d8d08e97) Initial stable release. Pure rendering-primitives library: the shape-tailored dispatcher matrix, the reducer, the agent and Ink render paths, synthesizers, and the PubSub channel. Knows nothing about the reporter lifecycle.

### Patch Changes

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 0.0.0 | 1.0.0 |
