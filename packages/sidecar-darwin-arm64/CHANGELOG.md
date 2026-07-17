# @vitest-agent/sidecar-darwin-arm64

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
