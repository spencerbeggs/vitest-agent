---
"@vitest-agent/plugin": minor
---

## Features

* `processFailure` accepts an optional second argument, `{ readSource }`, to supply the function that reads the top frame's source file. It defaults to reading from disk, and a throw is treated as an unreadable file.
