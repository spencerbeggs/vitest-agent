# Interface

* [@vitest-agent/sdk/dispatch](sdk-dispatch.md) - The pure, process-free argv dispatcher the sidecar SEA binaries and the CLI's inject-env fallback both call.
* [AgentPlugin.discover() / DiscoverStrategy](discover-api.md) - The workspace-discovery API: AgentPlugin.discover(), discoverProjects(), the DiscoverStrategy contract, and the WalkerFileSystem port.
* [AgentPluginOptions](agent-plugin-options.md) - The AgentPlugin({ ... }) options shape: exactly six fields, the coverage-level presets, and the executor→console-mode matrix.
* [Claude Code hook environment contract](hook-env-contract.md) - The VITEST\_AGENT\_\* environment surface a Claude Code hook, the sidecar, or a dispatched subagent may rely on — the canonical UUIDs, the sidecar bin path, the CLI override, the resolution order, the PreToolUse allowlist, and the SubagentStop state-file pairing.
* [MCP tool and prompt surface](mcp-tools.md) - The 30 action-keyed tools and six framing prompts @vitest-agent/mcp serves over stdio: families, discriminators, strictness, the TDD error envelope, and what stays stable across a minor.
* [Published JSON Schema documents](published-json-schemas.md) - The generated JSON Schema documents @vitest-agent/sdk ships, committed at the repo-root schemas/ tree and served raw by GitHub.
* [Report files](report-files.md) - The versioned .vitest report files a reporter-independent reader consumes.
* [Reporter contract](reporter-contract.md) - The consumer-facing contract between AgentPlugin and any VitestAgentReporterFactory implementation.
* [The \`vitest-agent\` CLI command tree](cli.md) - The stable command/flag/exit-code contract of the vitest-agent bin, as consumed by the Claude Code plugin's hook scripts and by humans on a terminal.
* [vitest-agent.config.toml](config-toml.md) - The optional workspace-root TOML file that overrides the default data-path resolution.
