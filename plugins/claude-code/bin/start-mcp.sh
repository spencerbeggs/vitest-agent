#!/usr/bin/env sh

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
export VITEST_AGENT_REPORTER_PROJECT_DIR="$ROOT"

detect_pm() {
  if [ -f "$ROOT/package.json" ]; then
    pm=$(jq -r '.packageManager // empty' "$ROOT/package.json" 2>/dev/null | cut -d'@' -f1)
    if [ -n "$pm" ]; then
      echo "$pm"
      return
    fi
  fi

  if [ -f "$ROOT/pnpm-lock.yaml" ]; then
    echo "pnpm"
  elif [ -f "$ROOT/yarn.lock" ]; then
    echo "yarn"
  elif [ -f "$ROOT/bun.lock" ]; then
    echo "bun"
  else
    echo "npm"
  fi
}

PM=$(detect_pm)
case "$PM" in
  pnpm) exec pnpm exec vitest-agent-mcp "$@" ;;
  yarn) exec yarn exec vitest-agent-mcp "$@" ;;
  bun)  exec bunx vitest-agent-mcp "$@" ;;
  *)    exec npx --no -- vitest-agent-mcp "$@" ;;
esac
