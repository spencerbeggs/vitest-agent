---
"@vitest-agent/ui": minor
---

## Features

- The stream console view now aligns every aggregate row into fixed columns: pass/fail/skip/timeout counts render right-aligned in 4-digit cells with dimmed zeros, and durations render right-aligned in a fixed 7-character cell.
- Tag counts render as true columns via the new `TagColumns` component and `tagUnion` helper: every row shows every tag in the view-level union with dimmed zeros, and a view whose union is a single tag shows no tag columns at all. This replaces the old sparse per-row tag suffix.
- The workspace `Total:` line pads its label so its count columns sit directly under the project rows.
- New public exports: `TagColumns`, `TagColumnsProps`, `tagUnion`, and `DURATION_CELL_WIDTH`.
