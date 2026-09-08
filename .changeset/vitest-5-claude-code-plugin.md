---
"@vitest-agent/claude-code-plugin": minor
---

## Documentation

* `/setup` command now checks for Vitest 5.0 or newer instead of 4.1, matching the plugin's new Vitest 5 floor
* `configuration` skill documents that inline projects inherit the root config (and `AgentPlugin`) by default under Vitest 5, and that `extends: false` opts a project out of both
* `CLAUDE.md`'s command table row for `/setup` now says "Verify Vitest 5.0+" instead of "4.1+"
