# Incident

* [Stranded live-view headers from a test's git notices](2026-10-07-stranded-live-view-headers.md) - Duplicate Projects (N): header lines piled up in the stream live view. The cause was a test whose git worktree add inherited stderr, writing under the Ink frame, and not terminal width. The guard is a quiet, piped git helper plus the stray-output capture that now prints such lines above the frame.
