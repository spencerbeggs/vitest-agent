---
"vitest-agent-reporter": patch
---

## Bug Fixes

The `stream` console renderer no longer clears the terminal when it mounts. It previously wiped the whole screen on the first run event to anchor its live region at the top, which destroyed the user's scrollback and any preceding command output on every run. It now renders inline beneath existing output like an ordinary progressive reporter.

The live frame is additionally clamped to one column narrower than the terminal so a project or module row can never exactly fill the width and trip the terminal's auto-wrap. That auto-wrap previously desynced Ink's line accounting and stranded a duplicate `Projects (N):` header above the final frame, worsening as the terminal got narrower.
