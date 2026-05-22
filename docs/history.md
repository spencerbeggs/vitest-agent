# Failure History and Test Classification

The reporter tracks per-test pass/fail outcomes across runs in a 10-run
sliding window. Each test is classified based on its history, and
classifications appear in both console output and the SQLite database.

## How It Works

Every time `AgentReporter.onTestRunEnd` fires, the reporter:

1. Extracts all test outcomes (pass/fail) from the current run
2. Reads the existing history from the SQLite database for each project
3. Prepends the current run to each test's history, pruning to 10 entries
4. Classifies each test based on its updated history
5. Attaches classifications to the test report
6. Writes the updated history to the database

History is always written -- there is no toggle. The data is lightweight
(10 entries per test) and only useful when it has been accumulating.

## Classifications

| Classification | Meaning |
| --- | --- |
| `stable` | Passed in the current run with no failures in the window |
| `new-failure` | Failed in the current run with no prior failures (or first time seen) |
| `persistent` | Failed in the current run, and the previous run also failed |
| `flaky` | Failed in the current run, but the window has a mix of passes and failures |
| `recovered` | Passed in the current run, but has failures in the window |

Two distinctions matter for accurate classification. First, `persistent` vs `flaky`: if the immediately preceding run was also a failure, the test is persistent; a mix of passes and failures in the window classifies it as flaky. Second, `flaky` vs `recovered`: a window where all failures occurred before all passes — a monotonically red-to-green sequence — classifies as `recovered`, not `flaky`. A test is `flaky` only when failures and passes are interleaved without a clean directional boundary.

## Console Output

Failed tests show their classification in brackets:

```markdown
- x **compressLines > handles empty array** [new-failure]
  Expected [] to equal [""]

- x **compressLines > handles duplicates** [persistent]
  Expected [1,2] to equal [1]
```

The "Next steps" section prioritizes actions based on classifications:

1. **New failures** -- most likely caused by recent changes
2. **Persistent failures** -- pre-existing, may not be yours
3. **Flaky tests** -- may pass on retry
4. Re-run commands for affected files
5. Hint to run `vitest-agent history` for deeper analysis
6. MCP tool hints (when `mcp: true` is set)

## CLI History Command

For a deeper view of failure trends:

```bash
npx vitest-agent history
```

This shows flaky tests (sorted by fail rate), persistent failures
(with consecutive failure count), and recently recovered tests. Each
entry includes a P/F visualization showing the run pattern over time.

See [CLI Commands](cli.md) for details.

## MCP Tools

The MCP server provides tools for querying history data:

- **`test_history`** -- flaky, persistent, and recovered tests with run
  visualization
- **`test_errors`** -- search errors by type or message across projects

See [MCP Server](mcp.md) for the full tool reference.

## Programmatic Access

History schemas and the HistoryTracker service are exported for
programmatic use:

```typescript
import {
  HistoryRecord,
  TestHistory,
  TestRun,
  HistoryTracker,
  HistoryTrackerLive,
} from "vitest-agent-sdk";
```

See [Schemas](schemas.md) for the full schema reference.
