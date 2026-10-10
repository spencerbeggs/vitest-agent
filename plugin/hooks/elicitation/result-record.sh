#!/usr/bin/env bash
# ElicitationResult hook (Claude Code only) — no action needed yet; answers
# with a no-op. Copilot has no ElicitationResult event; the config omits the
# entry there.
set -euo pipefail

. "$(dirname "$0")/../lib/pluginfinity/hook.sh"

hook_noop
