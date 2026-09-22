---
type: Module
title: docs (website/)
description: The RSPress 2.0 documentation site for the whole vitest-agent family, deployed to vitest-agent.dev via Cloudflare Pages, keyed off the plugin package's GitHub Release.
kind: website
resource: ../../website
status: stable
tags:
  - docs
  - ci
  - release
sources:
  - id: rspress-config
    resource: ../../website/rspress.config.ts
  - id: website-package-json
    resource: ../../website/package.json
  - id: website-turbo-json
    resource: ../../website/turbo.json
  - id: nav-json
    resource: ../../website/docs/en/_nav.json
  - id: deploy-workflow
    resource: ../../.github/workflows/deploy-docs.yml
  - id: sdk-build-config
    resource: ../../packages/sdk/savvy.build.ts
  - id: sdk-turbo-json
    resource: ../../packages/sdk/turbo.json
generated:
  by: okfit/claude-code
  at: 2026-09-16T01:24:14Z
  body_sha256: 2c5fdb314641b196c1ff69ce5d1d80d85683eedb68667839c1c7c39225353e95
---

# docs (website/)

## Purpose

`website/` is the user-facing documentation site for the whole
`vitest-agent` family: an RSPress 2.0 MDX site that builds to a static
bundle and deploys to <https://vitest-agent.dev>. The npm package name is
`docs`, not `vitest-agent-website` — Turbo filters and CI reference it as
`--filter=docs`[^website-package-json]. It is `"private": true`, never
published, and versions independently of the runtime packages, keyed off
its own `package.json#version`. Nothing in the runtime packages imports
from it; its only inputs at build time are the published packages' API
Extractor model files, not their code.

## Information architecture

Top nav is two entries, **Guide** and **Packages**, wired in
`website/docs/en/_nav.json`[^nav-json]. `/guide`
(`website/docs/en/guide/`) is the learning spine — getting-started,
concepts, how-to, and operating-as-an-agent pages, the last group aimed at
an agent driving the tool (running tests via MCP, silencing leaking
output, known issues) rather than a human reader. Each of the eight
packages (`plugin`, `sdk`, `engine`, `mcp`, `cli`, `reporter`, `ui`,
`sidecar`) owns a directory under `website/docs/en/<short>/` holding an
Overview `index.mdx`, hand-written deep-dive pages, and a generated `api/`
subtree[^nav-json]. `/packages` (`website/docs/en/packages/`) is the
ecosystem map orienting a reader across the package family. Per-directory
`_meta.json` files drive sidebar ordering within each section; the site is
single-locale (English) under `docs/en/` today, with the directory shape
leaving room for more.

The site does not host the family's JSON Schema documents: `run.json`'s
`$id` is a GitHub raw URL of the committed repo-root `schemas/5.0/run.json`,
so no docs deploy is on the path to publishing one. See [Published JSON
Schema Documents](../interfaces/published-json-schemas.md) for the schema
contract itself.

## API reference generation

API pages are generated, never hand-written. The published
`rspress-plugin-api-extractor` plugin renders them from API Extractor
model files, configured in `rspress.config.ts` via
`ApiExtractorPlugin.apis.fromDir("./lib/models")`[^rspress-config]. Each
package's own production build produces the model file it reads: a
package's `savvy.build.ts` declares `meta.localPaths` pointing at
`website/lib/models/<short>/` (`packages/sdk/savvy.build.ts` is the
canonical example), and that path is listed in the package's `build:prod`
Turbo task's `outputs`[^sdk-build-config]. `packages/sdk/turbo.json`'s
`build:prod` task extends the shared config and adds
`../../website/lib/models/sdk` to its `outputs`
array[^sdk-turbo-json]. When a package builds for production it therefore
copies its API Extractor model into the site's `lib/models/` tree, and the
docs build reads from there — `website/turbo.json`'s own `build` task
`dependsOn`s every package's `build:prod`[^website-turbo-json].

Two classes of generated artifact are deliberately gitignored: the
copied-in models (`website/lib/models/*`) and the rendered API pages
(`website/docs/en/*/api/`). The committed source of truth for generation
is `website/api-docs-snapshot.db` — tracked in git so a CI build reproduces
the same API pages deterministically without re-running every package's
full build first; its `-shm`/`-wal` sidecar files are gitignored.

## Deploy

The deploy pipeline is `.github/workflows/deploy-docs.yml`, triggered on
`release: published` and on manual `workflow_dispatch`[^deploy-workflow]. A
changesets release from one version PR can publish several
`@vitest-agent/*` packages at once, each with its own GitHub Release at its
own version — to deploy exactly once per release event rather than once
per published package, the workflow's `if` guard checks that
`github.event.release.name` contains `@vitest-agent/plugin`, a substring
no other package name carries. The job checks out `main`, rebuilds the
site from the committed snapshot database via `turbo run build
--filter=docs`, and publishes `website/dist` to the Cloudflare Pages
project named `vitest-agent` via `cloudflare/wrangler-action`.

**Bootstrap caveat, documented in the workflow header.** Until
`rspress-plugin-api-extractor` is published to npm and `website/package.json`
swaps its local `link:` dependency for the published version, a CI runner
cannot resolve the plugin — so the first dispatch or release deploy
requires that swap to have already landed on `main`.

## Choices absorbed here

**Why a static site keyed on the plugin's Release rather than its own.**
The docs workspace has no independent release cadence of its own to key
a deploy off of — versioning `docs` independently exists so the site can
iterate on prose without forcing a package bump, not so it drives CI. Using
the plugin package's Release name as the trigger substring piggybacks on
the one release event guaranteed to fire once per changesets release cycle,
regardless of how many packages that cycle actually published.

**Why the snapshot database is committed rather than regenerated from
scratch on every deploy.** Regenerating `website/lib/models/*` for a docs
deploy would require rebuilding every one of the eight packages in
production mode first, on every deploy. Committing
`website/api-docs-snapshot.db` as the source of truth means a `main`
checkout alone is sufficient to reproduce the same API pages
deterministically.

[^rspress-config]: `website/rspress.config.ts`
[^website-package-json]: `website/package.json`
[^website-turbo-json]: `website/turbo.json`
[^nav-json]: `website/docs/en/_nav.json`
[^deploy-workflow]: `.github/workflows/deploy-docs.yml`
[^sdk-build-config]: `packages/sdk/savvy.build.ts:7`
[^sdk-turbo-json]: `packages/sdk/turbo.json:5`
