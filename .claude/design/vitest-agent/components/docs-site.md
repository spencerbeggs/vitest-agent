---
status: current
module: vitest-agent
category: documentation
created: 2026-05-27
updated: 2026-06-30
last-synced: 2026-06-30
completeness: 85
related:
  - ../architecture.md
  - ../components.md
  - ../file-structure.md
  - ../decisions.md
dependencies: []
---

# Docs site (`docs` workspace)

The user-facing documentation site for the whole `vitest-agent` family. An RSPress 2.0 MDX site that builds to a static bundle and deploys to <https://vitest-agent.dev> via Cloudflare Pages. It lives in the `website/` directory as the pnpm workspace named `docs` — the package `name` is `docs`, not `vitest-agent-website`, so Turbo filters and CI reference it as `--filter=docs`.

**npm name:** `docs` (private, never published)
**Location:** `website/`
**Build entry:** `website/rspress.config.ts`
**Internal dependencies:** none at runtime — it consumes the published packages' API Extractor models as build inputs, not as imports.

The site is not one of the seven publishable packages; like every package in the family it versions independently, keyed off its own `package.json#version`. It exists purely to render documentation; nothing in the runtime packages imports from it.

## Information architecture

Top nav is two entries, **Guide** and **Packages**, wired in `website/docs/en/_nav.json` with a per-package dropdown under Packages.

- `/guide` (`website/docs/en/guide/`) is the learning spine: getting-started, concepts, how-to and operating-as-an-agent pages. This is the narrative path a reader follows — the first three groups target a human user, the operating-as-an-agent group targets an agent driving the tool (running tests via MCP, silencing leaking output, known issues).
- Each of the seven packages owns a directory under `website/docs/en/<short>/` (`plugin`, `sdk`, `mcp`, `cli`, `reporter`, `ui`, `sidecar`) holding an Overview `index.mdx`, hand-written deep-dive pages and a generated `api/` subtree.
- `/packages` (`website/docs/en/packages/`) is the ecosystem map that orients a reader across the package family.

Per-directory `_meta.json` files drive sidebar ordering within each section. The locale is scoped under `docs/en/`; the site is single-locale (English) today but the directory shape leaves room for more.

The site's content supersedes the pre-existing repo-root `docs/*.md` user docs — that material was migrated and expanded into `website/docs/en/`. The repo-root `docs/*.md` files are slated for retirement and should be treated as stale; new user-facing prose belongs in the site, not there.

## API reference generation

API pages are generated, not hand-written. The published `rspress-plugin-api-extractor` plugin renders them from API Extractor model files, configured in `rspress.config.ts` via `ApiExtractorPlugin.api.fromModelsDir("./lib/models")`.

The model files are produced by each package's own production build. A package's `rslib.config.ts` declares `apiModel.localPaths` pointing at `website/lib/models/<short>/`, and that path is listed in the package's `build:prod` Turbo `outputs` (see `packages/sdk/rslib.config.ts` and `packages/sdk/turbo.json` for the canonical wiring). So when a package builds for production it copies its API Extractor model into the site's `lib/models/` tree, and the docs build reads from there. The site's `turbo.json` `build` task therefore `dependsOn` every package's `build:prod`.

Two classes of generated artifact are deliberately gitignored (see the consolidated rules in the root `.gitignore`): `website/lib/models/*` (the copied-in models) and `website/docs/en/*/api/` (the rendered pages). The committed source of truth for generation is `website/api-docs-snapshot.db` — that database is tracked in git so a CI build reproduces the same API pages deterministically without re-running every package's full build first. The `-shm` / `-wal` sidecar files of that snapshot db are gitignored.

## Deploy

The deploy pipeline is `.github/workflows/deploy-docs.yml`. It triggers on `release: published` and on manual `workflow_dispatch`.

A changesets release from one version PR can publish several `@vitest-agent/*` packages at once, and each package gets its own GitHub Release at its own version. To deploy exactly once per release event rather than once per published package, the workflow's `if` guard keys on the plugin package's Release — it checks that `github.event.release.name` contains `@vitest-agent/plugin`, a substring no other package name carries. The job checks out `main`, rebuilds the site from the committed snapshot db, and publishes `website/dist` to the Cloudflare Pages project named `vitest-agent` via `cloudflare/wrangler-action`.

There is a bootstrap caveat documented in the workflow header: until `rspress-plugin-api-extractor` is on npm and `website/package.json` swaps its local dependency for the published version, a CI runner cannot resolve the plugin, so the first dispatch or release deploy requires that swap to have landed on main first.

## Where to look

| Concern | File |
| --- | --- |
| Nav, locales, plugins, site metadata | `website/rspress.config.ts` |
| Top-nav structure | `website/docs/en/_nav.json` |
| Per-section sidebar ordering | `website/docs/en/<section>/_meta.json` |
| Local dev / preview helpers | `website/lib/scripts/dev.mts`, `website/lib/scripts/preview.mts` |
| Build orchestration and per-package `build:prod` dependency | `website/turbo.json` |
| Generation source of truth | `website/api-docs-snapshot.db` (committed) |
| Quick-reference layout and conventions | `website/CLAUDE.md` |
