# @vitest-agent/sidecar-linux-arm64

## 2.1.0

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.3.1 | 2.4.0 |

### Maintenance

* Bumps all packages to use `effect@rc.109`

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 2.0.13

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.3.0 | 2.3.1 |

## 2.0.12

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.2.1 | 2.3.0 |

## 2.0.11

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.2.0 | 2.2.1 |

## 2.0.10

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.1.0 | 2.2.0 |

## 2.0.9

### Dependencies

| Dependency        | Type       | Action  | From   | To    |
| ----------------- | ---------- | ------- | ------ | ----- |
| @vitest-agent/sdk | dependency | updated | 2.0.16 | 2.1.0 |

## 2.0.8

### Dependencies

| Dependency        | Type       | Action  | From   | To     |
| ----------------- | ---------- | ------- | ------ | ------ |
| @vitest-agent/sdk | dependency | updated | 2.0.15 | 2.0.16 |

## 2.0.7

### Dependencies

| Dependency        | Type       | Action  | From   | To     |
| ----------------- | ---------- | ------- | ------ | ------ |
| @vitest-agent/sdk | dependency | updated | 2.0.14 | 2.0.15 |

## 2.0.6

### Dependencies

| Dependency        | Type       | Action  | From   | To     |
| ----------------- | ---------- | ------- | ------ | ------ |
| @vitest-agent/sdk | dependency | updated | 2.0.13 | 2.0.14 |

## 2.0.5

### Dependencies

| Dependency        | Type       | Action  | From   | To     |
| ----------------- | ---------- | ------- | ------ | ------ |
| @vitest-agent/sdk | dependency | updated | 2.0.12 | 2.0.13 |

## 2.0.4

### Dependencies

| Dependency        | Type       | Action  | From   | To     |
| ----------------- | ---------- | ------- | ------ | ------ |
| @vitest-agent/sdk | dependency | updated | 2.0.11 | 2.0.12 |

## 2.0.3

### Dependencies

| Dependency        | Type       | Action  | From   | To     |
| ----------------- | ---------- | ------- | ------ | ------ |
| @vitest-agent/sdk | dependency | updated | 2.0.10 | 2.0.11 |

## 2.0.2

### Dependencies

| Dependency        | Type       | Action  | From  | To     |
| ----------------- | ---------- | ------- | ----- | ------ |
| @vitest-agent/sdk | dependency | updated | 2.0.9 | 2.0.10 |

## 2.0.1

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.0.8 | 2.0.9 |

## 2.0.0

### Breaking Changes

* ### Effect v4 family alignment

  The `@vitest-agent/sidecar` umbrella package and its four per-platform binary packages (`sidecar-darwin-arm64`, `sidecar-linux-arm64`, `sidecar-linux-x64`, `sidecar-win32-x64`) bump to `2.0.0` alongside the rest of the family's Effect v4 migration, keeping every `@vitest-agent/*` package on a single `2.0` version line.

  The prebuilt Single Executable Application binaries are rebuilt for the `2.0` line and bundle the `2.0` `@vitest-agent/sdk` `./dispatch` entry. The dispatch core itself — per-Bash-call environment injection and exit-code mapping — is unchanged, so the binaries' runtime behavior is identical to `1.x`; the major bump is a version-alignment guarantee for consumers pinning the family, not a behavioral break. [#161][#161]

### Major Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#161]: https://github.com/spencerbeggs/vitest-agent/pull/161

## 1.0.2

### Dependencies

* [`3e0cfe3`](https://github.com/spencerbeggs/vitest-agent/commit/3e0cfe38157ef21bfe1d817f557914ce79a43885) | Dependency | Type | Action | From | To |
  \| ------------------ | ------------- | ------- | ------- | ------ |
  \| @savvy-web/bundler | devDependency | updated | ^0.11.1 | ^1.0.1 |

## 1.0.1

## 1.0.0

### Features

* [`e509228`](https://github.com/spencerbeggs/vitest-agent/commit/e5092289c0f64446dddc8ad0abc25856d8d08e97) Initial release of the prebuilt per-platform sidecar binaries.
