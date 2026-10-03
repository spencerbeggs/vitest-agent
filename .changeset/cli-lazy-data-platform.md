---
"@vitest-agent/cli": patch
---

## Bug Fixes

* The CLI now opens the project database only for commands that read or write it. Hook commands such as `agent inject-env`, `agent check-test-path`, `agent register-agent` and `agent end-agent` no longer open and migrate a second cwd-derived `data.db` on every call, and `db reset` no longer deletes a database the process holds open.
* `db path`, `db reset` and `db query` resolve the project directory the same way as every other command, honoring `CLAUDE_PROJECT_DIR`.
