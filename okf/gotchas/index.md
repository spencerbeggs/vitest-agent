# Gotcha

* [An interactive exit can print "Hook cancelled" even though SessionEnd succeeded](sessionend-hook-cancelled.md) - Claude Code aborts an in-flight SessionEnd hook on an interactive exit and reports "Hook cancelled", which looks like a failed session-close write; the plugin's shim already detaches the real work so the write still lands.
* [XDG data-root fallback splits between the reporter and the hook routes](xdg-fallback-split.md) - With XDG\_DATA\_HOME unset, the reporter/MCP route and the hook/sidecar route resolve two different fallback data roots, so they can silently open two different databases.
* [tdd\_phase\_transition\_request is annotated Idempotent but is not](phase-transition-not-idempotent.md) - The tool declares Tool.Idempotent(true) yet is absent from the MCP idempotency-key registry, so a retried call opens a second phase transition instead of replaying the first.
