---
"vitest-agent-plugin": patch
---

## Maintenance

`vitest-agent-sidecar` is removed from `vitest-agent-plugin`'s `peerDependencies`. Consumers who previously satisfied that peer requirement no longer need to install `vitest-agent-sidecar` directly — it arrives transitively via `vitest-agent-cli`, which is still a required peer and now declares `vitest-agent-sidecar` as a regular dependency.
