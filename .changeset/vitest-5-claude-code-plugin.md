---
"@vitest-agent/claude-code-plugin": minor
---

## Features

* The `/setup` command's version gate now requires Vitest 5.0.0 or newer
  and names `vite` in the install instructions, since Vitest 5 declares
  it as a required peer dependency.

## Documentation

* Skill text updated for Vitest 5: the `-t` / `--testNamePattern`
  separator is now `' > '`, which matches the `Suite > test` names the
  `test_status`, `test_errors`, and `test` tools already print, so a name
  copied from tool output can be pasted straight into a filter.
* The configuration skill documents that inline projects inherit the root
  config by default under Vitest 5, and that `extends: false` opts out —
  and therefore drops the plugin.
