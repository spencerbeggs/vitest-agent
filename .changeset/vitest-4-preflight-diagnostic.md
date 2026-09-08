---
"@vitest-agent/plugin": patch
---

## Bug Fixes

* `AgentPlugin`'s `configureVitest` now fails fast with a single clean
  `vitest-agent: ...` stderr line when the host project's `vitest` peer
  resolves to a pre-5 release, instead of letting the raw
  `TypeError: ctx.defineCacheKeyGenerator is not a function` surface
  with a stack trace and an issue-report URL. The diagnostic reports the
  detected Vitest version when it can be read off the Vitest instance,
  and points the user at `@vitest-agent/plugin` 2.x for Vitest 4. Every
  other `configureVitest` error keeps its existing stack-plus-issue-URL
  treatment.
