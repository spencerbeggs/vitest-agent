# vitest-agent-ui

Shared event-sourced renderer for
[vitest-agent-plugin](https://github.com/spencerbeggs/vitest-agent). Carries
the streaming `RunEvent` taxonomy, the pure reducer, two terminal renderers
(a markdown-flavored agent string and a React Ink tree), an Effect `PubSub`
channel for live event transport, a `VitestAgentReporterFactory`
implementation (`eventSourcedReporter`), and a live-mount Ink driver
(`createLiveInk`).

This package is a required peer dependency of `vitest-agent-plugin`, so you
usually don't install it directly — modern pnpm and npm pull it in
automatically when you install the plugin. Install explicitly if your
package manager skips peers:

```bash
pnpm add -D vitest-agent-ui
```

`react` and `ink` are themselves peer dependencies of this package; they
are required (not optional). If you only need the markdown agent path, you
still pay the install cost for both today.

## Exports

| Name | What it is |
| --- | --- |
| `renderRun(events, mode, opts)` | Synchronous host entry point. Dispatches between the markdown agent string and the React Ink view based on `mode`. Returns a `string` |
| `createLiveInk(opts?)` | Imperative orchestration for a live Ink mount. Returns `{ event, snapshot, unmount }`. Wire `event` to `AgentPlugin({ onRunEvent })` |
| `eventSourcedReporter` | A `VitestAgentReporterFactory` for use as `AgentPlugin({ reporter })`. Dispatches on `kit.config.consoleMode`: emits the agent string for `"agent"`, emits nothing for `"ink"`, `"ci-annotations"`, `"silent"`, `"passthrough"` (other channels own the visible work) |
| `synthesizeRunEvents`, `synthesizeFromAgentReport` | Two bridges into the event taxonomy. The first reads live Vitest module data, the second reads a persisted `AgentReport` from `vitest-agent-sdk` |
| `RunEventChannel`, `RunEventChannelLive` | Effect tag and scoped Layer providing `PubSub.unbounded<RunEvent>` for live event transport |
| `reduceRunEvent`, `reduceRenderStateAll` | The pure reducer and the convenience fold over a full sequence |
| `renderAgent`, plus the Ink components in `render-ink/` | The lower-level renderers `renderRun` dispatches to |

## Wiring the live React Ink view

Pair `createLiveInk` with `AgentPlugin` to drive a live tree on `human`
runs. The plugin only forwards `onRunEvent` to the reporter when the
resolved console mode is `"ink"`, so the live mount cannot leak into
`"silent"`, `"passthrough"`, `"agent"`, or `"ci-annotations"` channels.

```typescript
import { AgentPlugin } from "vitest-agent-plugin";
import { createLiveInk } from "vitest-agent-ui";
import { defineConfig } from "vitest/config";

const live = createLiveInk();

export default async () => {
  const { projects, tags } = await AgentPlugin.discover();
  return defineConfig({
    plugins: [
      AgentPlugin({
        console: { human: "ink" },
        onRunEvent: live.event,
      }),
    ],
    test: { projects, tags, pool: "forks" },
  });
};
```

Mount failures degrade silently with a stderr warning — persistence and
data writes never break because a renderer has a bug.

## Using `eventSourcedReporter`

`eventSourcedReporter` is a drop-in `VitestAgentReporterFactory` that
routes the end-of-run rendering pipeline through the same event taxonomy
the live view uses. Pass it as `AgentPlugin({ reporter })`:

```typescript
import { AgentPlugin } from "vitest-agent-plugin";
import { eventSourcedReporter } from "vitest-agent-ui";

AgentPlugin({
  console: { agent: "agent" },
  reporter: eventSourcedReporter,
});
```

## Replaying a cached run from the CLI

The `vitest-agent show` command uses `renderRun` plus
`synthesizeFromAgentReport` internally:

```bash
npx vitest-agent show --project <name> --format auto
```

`--format auto` picks the Ink view for an interactive TTY and the markdown
agent string otherwise. Pass `agent`, `human`, or `json` to force a
specific output. The same renderer drives the live view during a run, so a
captured run replays byte-identically to what the live view showed.

## Documentation

See the
[main README](https://github.com/spencerbeggs/vitest-agent#readme)
and the
[configuration reference](https://github.com/spencerbeggs/vitest-agent/blob/main/docs/configuration.md#console).

## License

[MIT](./LICENSE)
