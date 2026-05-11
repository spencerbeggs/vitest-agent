#!/usr/bin/env bash
# PreToolUse hook: inject a one-line resource nudge when an agent reads a
# Vitest configuration or setup file.
#
# Common filenames matched: vitest.config.ts/.js/.mts/.mjs,
# vitest.setup.ts/.js, vitest.globals.ts, vitest.env.ts.
# Only fires on the Read tool (enforced by hooks.json matcher).

set -euo pipefail

# shellcheck source=../lib/hook-output.sh
. "$(dirname "$0")/../lib/hook-output.sh"

ENVELOPE=$(cat)
FILE_PATH=$(echo "$ENVELOPE" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
  emit_noop
  exit 0
fi

BASENAME=$(basename "$FILE_PATH")

case "$BASENAME" in
  vitest.config.ts|vitest.config.js|vitest.config.mts|vitest.config.mjs|\
  vitest.setup.ts|vitest.setup.js|vitest.setup.mts|vitest.setup.mjs|\
  vitest.globals.ts|vitest.globals.js|\
  vitest.env.ts|vitest.env.js)
    emit_additional_context "PreToolUse" \
      "<vitest-resources>Vitest documentation and project patterns are available via MCP resources. Load \`vitest://docs/\` or \`vitest-agent://patterns/\` indexes using \`ReadMcpResourceTool\`, or invoke the \`vitest-context\` skill for the full navigation guide.</vitest-resources>"
    ;;
  *)
    emit_noop
    ;;
esac

exit 0
