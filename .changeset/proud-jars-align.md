---
"@vitest-agent/sidecar": major
"@vitest-agent/sidecar-darwin-arm64": major
"@vitest-agent/sidecar-linux-arm64": major
"@vitest-agent/sidecar-linux-x64": major
"@vitest-agent/sidecar-win32-x64": major
---

## Breaking Changes

### Effect v4 family alignment

The `@vitest-agent/sidecar` umbrella package and its four per-platform binary packages (`sidecar-darwin-arm64`, `sidecar-linux-arm64`, `sidecar-linux-x64`, `sidecar-win32-x64`) bump to `2.0.0` alongside the rest of the family's Effect v4 migration, keeping every `@vitest-agent/*` package on a single `2.0` version line.

The prebuilt Single Executable Application binaries are rebuilt for the `2.0` line and bundle the `2.0` `@vitest-agent/sdk` `./dispatch` entry. The dispatch core itself — per-Bash-call environment injection and exit-code mapping — is unchanged, so the binaries' runtime behavior is identical to `1.x`; the major bump is a version-alignment guarantee for consumers pinning the family, not a behavioral break.
