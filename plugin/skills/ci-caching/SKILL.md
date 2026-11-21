---
name: ci-caching
description: >-
  Use when configuring, reviewing, or speeding up a Vitest test job in GitHub Actions, when persisting Vitest 5's fs
  module cache between CI runs (VITEST_FS_MODULE_CACHE_PATH, fsModuleCache), or when any cache that grows run over run
  needs to stay warm in actions/cache. Covers the rotating-key pattern (a per-run key plus a restore prefix), why a
  cache inside node_modules or under a fixed key freezes, size caps, fork safety, and measuring cold against warm.
---

# Caching Vitest in GitHub Actions

Vitest 5 persists transformed modules to disk between runs (`fsModuleCache`, on by default). On a laptop this
just works. In CI it is easy to configure a cache that restores fine and still never helps, because the entry
stops learning after its first save. This skill gives the pattern that keeps such a cache warm, with Vitest's
module cache as the worked example.

## Why the obvious setups go stale

- **The default location is inside `node_modules`** (`node_modules/.vitest-cache` at the workspace root). If CI
  installs dependencies fresh, the cache is cold every run. If CI caches `node_modules` keyed on the lockfile,
  the Vitest cache rides along, but a dependency cache is saved only when its key misses, so the Vitest cache
  stays as the first run on that lockfile left it. Every source change after that is a cache miss.
- **An `actions/cache` entry is immutable.** A key such as `vitest-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}`
  is written once and then only ever restored. It freezes the same way.

Neither is wrong, since cache entries are content-hashed, so a stale cache is slower, never incorrect. But it
decays toward useless.

## The pattern: a rotating key

Give the cache its own directory, save a **new** entry on every run, and restore the newest entry that shares a
prefix:

- **Key:** `<prefix><unique per run>`, for example `${{ github.run_id }}`.
- **Restore keys:** `<prefix>`. `actions/cache` restores the most recently created entry whose key starts with it.
- **Prefix:** everything that makes an old entry useless: OS, plus the lockfile hash for Vitest, because Vitest
  invalidates its whole module cache when the lockfile changes, so an entry from an older lockfile restores
  nothing usable.

Each run starts from the last run's cache and leaves a slightly better one behind. Old entries fall out under
GitHub's least-recently-used eviction once the repository's cache quota fills.

## Worked example: Vitest's module cache

Point the cache outside `node_modules` with the environment variable, so the Vitest config does not change. A
`fsModuleCachePath` set in the config or on the CLI wins over the variable. `.cache/` is a good home: gitignore it
(`**/.cache`) and other tools can share it, for example `.cache/effected`.

```yaml
      - name: Vitest module cache key
        id: vitest-cache
        run: |
          echo "prefix=vitest-fs-${RUNNER_OS}-${{ hashFiles('pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock') }}-" >> "$GITHUB_OUTPUT"
          echo "path=${GITHUB_WORKSPACE}/.cache/vitest" >> "$GITHUB_OUTPUT"

      - name: Restore Vitest module cache
        uses: actions/cache/restore@v6
        with:
          path: ${{ steps.vitest-cache.outputs.path }}
          key: ${{ steps.vitest-cache.outputs.prefix }}${{ github.run_id }}
          restore-keys: ${{ steps.vitest-cache.outputs.prefix }}

      - name: Run tests
        env:
          VITEST_FS_MODULE_CACHE_PATH: ${{ steps.vitest-cache.outputs.path }}
        run: pnpm vitest run

      - name: Cap Vitest module cache
        id: vitest-cache-cap
        if: always()
        env:
          CACHE_DIR: ${{ steps.vitest-cache.outputs.path }}
          CAP_MB: "256"
        run: |
          if [ ! -d "$CACHE_DIR" ]; then echo "save=false" >> "$GITHUB_OUTPUT"; exit 0; fi
          size=$(du -sm "$CACHE_DIR" | cut -f1)
          echo "Vitest module cache is ${size} MB (cap ${CAP_MB} MB)"
          if [ "$size" -gt "$CAP_MB" ]; then echo "save=false"; else echo "save=true"; fi >> "$GITHUB_OUTPUT"

      - name: Save Vitest module cache
        if: always() && steps.vitest-cache-cap.outputs.save == 'true'
        uses: actions/cache/save@v6
        with:
          path: ${{ steps.vitest-cache.outputs.path }}
          key: ${{ steps.vitest-cache.outputs.prefix }}${{ github.run_id }}
```

Why each piece is there:

- **Separate restore and save steps.** The combined `actions/cache` action skips its save on an exact key hit
  and gives no hook for a cap. With `restore` and `save` you decide.
- **`always()` on the save.** A failing test run still transformed its modules; keep them.
- **An absolute path.** The variable's relative form resolves from Vitest's root, which may not be the checkout
  root in a monorepo or a nested `working-directory`.
- **The cap.** Vitest's manifest keeps entries from earlier runs, so within one lockfile's lifetime the cache only
  grows. Past the cap, skipping the save lets the next run start cold once instead of hauling an ever-larger
  archive. A lockfile change resets it through the prefix anyway.
- **`hashFiles` over every lockfile name.** Missing files are ignored, so one line serves any package manager.

## Untrusted runs: restore, never save

A cache entry saved by a pull request from a fork, or by any run executing code you have not reviewed, can be
restored later by a trusted run. Vitest executes what it restores, so a poisoned module cache is code execution
on your next run. Restore freely, but guard the save:

```yaml
        if: always() && steps.vitest-cache-cap.outputs.save == 'true' && github.event.pull_request.head.repo.full_name == github.repository
```

For a reusable workflow, pass an explicit input, such as `fork: true`, and guard on that instead.

GitHub's own scoping helps: a pull request can restore caches from its base branch but not from sibling pull
requests, and its saves are visible only to that pull request. Runs on `main` therefore keep the shared base warm.

## Measure before keeping it

A cache costs a restore and a save on every run. Check it pays for itself:

1. Push a change that alters the lockfile, or delete the entries, for a cold run.
2. Re-run the same commit. That run restores the entry the first one saved, so it is the warm number.
3. Compare the test step's duration, not the job's, since the restore and save are their own steps.

Unit-heavy suites gain the most, because transforms dominate their time; one measurement here went from 16 s cold
to 6 s warm. Suites dominated by spawned processes or real I/O gain less. To confirm modules are served from the
cache, run with `DEBUG=vitest:cache:fs`.

## vitest-agent and the module cache

`AgentPlugin` prepends a tag prelude to each classified test file, and the tags come from a scan of the workspace,
not from the file's content. The plugin registers a Vitest cache-key generator that folds each file's resolved
tags into its cache key, so a file classified differently since the cache was saved is transformed again rather
than served with its old tags. Nothing needs configuring for that. A custom plugin whose transform depends on
anything outside the file should register one too (`defineCacheKeyGenerator` in `configureVitest`), or a restored
cache can serve its stale output.

## The same pattern elsewhere

Use the rotating key for any cache that improves with use and stays correct when stale: compiler or bundler
caches, lint caches, test-result caches. Choose the prefix by asking what makes an old entry worthless (OS,
toolchain version, lockfile), and keep the per-run suffix. Use a fixed key only for a cache that is fully
determined by its key, such as a dependency store keyed on the lockfile.
