---
"@vitest-agent/plugin": patch
---

## Bug Fixes

- The Claude Code plugin's `test-location.sh` PreToolUse hook gained a `VITEST_AGENT_TEST_LOCATION_HOOK=off` opt-out, checked before anything else, so a project hitting a false-positive deny (a custom `DiscoverStrategy` the CLI's lexical detector doesn't understand) can disable the check entirely without editing `hooks.json` (#230).
- The hook's deny and additional-context messages now say "Under the default discovery layout" and name the opt-out, instead of stating the discoverable-test-layout rule as an unconditional fact (#230).
