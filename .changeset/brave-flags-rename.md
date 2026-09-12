---
"@vitest-agent/cli": patch
---

## Refactoring

* Ported the `vitest-agent` command tree to the PascalCase `effect/unstable/cli` constructors introduced in `effect@4.0.0-rc.113` (`Flag.String`, `Flag.Int`, `Flag.Boolean`, `Flag.Literals`, `Argument.String`). Flag names, defaults, help output, and parsing behaviour are unchanged.
