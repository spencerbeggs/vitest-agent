#!/usr/bin/env bash
set -euo pipefail
# Elicitation result hook — no action needed; emit no-op envelope.

# shellcheck source=../lib/hook-output.sh
. "$(dirname "$0")/../lib/hook-output.sh"

cat > /dev/null
emit_noop
exit 0
