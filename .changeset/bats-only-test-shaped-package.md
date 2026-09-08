---
"@vitest-agent/plugin": patch
---

## Bug Fixes

* `AgentPlugin`'s declined-package warning no longer fires for a package
  whose `__test__/` directory holds only Bats shell tests (`.bats`
  files, run by `bats`, not Vitest) — for example
  `@effected/claude-code-plugin`'s `plugins/claude-code/__test__/`. The
  `isTestShapedPackage` predicate now warns only when neither a
  discoverable Vitest test file nor a `.bats` file (searched recursively
  under the package) is found anywhere; a `__test__/` directory whose
  contents match neither convention — including an empty one — still
  warns exactly as before.
