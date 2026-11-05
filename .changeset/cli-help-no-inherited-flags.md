---
"@vitest-agent/cli": patch
---

## Bug Fixes

Subcommand help, and the help printed after a usage error, no longer repeats the INHERITED FLAGS section. It ends with a pointer to the parent command's help instead. Root help is unchanged and the inherited flags still work.

Failing `agent` hook commands now report through the kit's `CliExit.reportCause`, with the same exit codes. The stderr line can differ: it carries the error's full text and its cause chain, it is sanitized to one line, and an untagged failure or defect reads `5 <message>` rather than `5 UnknownError: <message>` or `5 Defect: <message>`. An interrupt-only cause now writes nothing and stays an interrupt instead of reporting exit 5.
