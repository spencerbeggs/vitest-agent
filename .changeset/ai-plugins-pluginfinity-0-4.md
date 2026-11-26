---
"@vitest-agent/ai-plugins": patch
---

## Maintenance

Rebuilds the Claude Code and Copilot plugins on pluginfinity 0.4.0. The bundled hook library now knows the current Claude Code event set: it skips a `systemMessage` on the events that discard one, and it does not fail closed on `TaskCompleted` or `TeammateIdle`. The Claude Code `hooks.json` also carries the plugin description. The hooks behave the same.
