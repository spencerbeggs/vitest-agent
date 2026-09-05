# CLAUDE.md — the `plugins/` workspace

This directory holds the repo's agent plugins. They are not npm packages: nothing here publishes, and all of it is repo infrastructure that reaches users through a plugin marketplace. The directory is plural to leave room for other agent platforms (a Copilot plugin is a stated goal, not a thing that exists); today `claude-code/` is the only plugin.

## Layout

| Path | What |
| ---- | ---- |
| `claude-code/` | The Claude Code plugin `vitest-agent`, distributed through the Claude marketplace as `vitest-agent@spencerbeggs`. Manifest at `claude-code/.claude-plugin/plugin.json`; contents in `agents/`, `bin/`, `commands/`, `hooks/`, `skills/` |

## Versioning: private tracking package

`pnpm-workspace.yaml` includes `plugins/*`, so the plugin IS a pnpm workspace member. `plugins/claude-code/package.json` declares `@vitest-agent/claude-code-plugin`, `"private": true` with **no `publishConfig`** — unlike a source package, where `private` is a build-time detail, here it is the whole point. Its only job is to give changesets something to version.

`.changeset/config.json` sets `privatePackages: { tag: true, version: true }` and maps the tracking package to its manifest through `@savvy-web/changelog` `versionFiles` (`plugins/claude-code/.claude-plugin/plugin.json` at `$.version`). CI bumps `package.json` and the manifest together, then cuts a git tag and GitHub Release (`@vitest-agent/claude-code-plugin@<version>`) with **no npm publish**.

**Write plugin changesets against `@vitest-agent/claude-code-plugin`.** A changeset for any other package does nothing for the plugin, and naming `@vitest-agent/plugin` (the Vitest plugin, `packages/plugin/`) forces a pointless npm build and publish.

## Tooling

- `pnpm test:bats` runs `bats --recursive plugins`; the suites live in `claude-code/hooks/__test__/`.
- `pnpm claude` loads the plugin locally via `claude --plugin-dir plugins/claude-code`.

## Going deeper

- `@./claude-code/CLAUDE.md` — Load when: working inside the plugin; it owns the directory layout, the MCP loader, and the hook / skill / command quick-reference tables.
- `@../.claude/design/vitest-agent/components/plugin-claude.md` — Load when: changing hook behavior, the `tdd-task` agent, skills, commands, or the dogfood workflow. Do not restate that material here.
