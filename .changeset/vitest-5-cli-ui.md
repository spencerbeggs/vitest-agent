---
"@vitest-agent/cli": patch
"@vitest-agent/ui": patch
---

## Maintenance

* Development-time Vitest pin moved to `5.0.0`. Neither package imports
  Vitest at runtime and neither declares a Vitest peer, so there is no
  change to installed behavior.
