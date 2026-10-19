# Marketplace submission — awesome-dsh-plugin

Draft for the PR that lists dsh-opencode-free in the dsh-market catalog
([awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)).
Format verified against that repo's `contributing.md` (2026-08-29).

> **BLOCKED: the repository is private.** The registry links a public URL and
> validates the manifest from it; a private repo fails that check. Publish the
> repository first, then run the checklist below. Everything here is prepared
> so submission is mechanical once the repo is public.

## The entry file

Add exactly one file:
`data/plugins/ddldxiacan__dsh-opencode-free--packages-plugin.yml`
(monorepo filename = `<owner>__<repo>--packages-plugin.yml`).

```yaml
url: https://github.com/ddldxiacan/dsh-opencode-free/tree/master/packages/plugin
name: ddldxiacan/dsh-opencode-free#packages/plugin
category: model
tarball: https://github.com/ddldxiacan/dsh-opencode-free/releases/latest/download/dsh-opencode-free-dsh-plugin.tgz
description:
  en: Registers OpenCode Zen free models in DeepSeek Harness with no API key.
  zh: 将 OpenCode Zen 免费模型接入 DeepSeek Harness，无需 API Key。
```

Notes on the wording (their review rules):

- `description.en` is the only required field; `zh` included for convenience.
- Description states what it does, no superlatives, ends with a period.
- Monorepo entries use `owner/repo#subname` as `name` and the filename
  `owner__repo--packages-plugin.yml` (verified against `contributing.md`).

**Why the subdirectory, not the root.** The manifest check reads the
`package.json` at the entry URL. `packages/plugin/package.json` is the real
plugin: it declares `dsh.bundle`, `dsh.client`, the exports and the
dependencies. The repository root is a wrapper whose only job is to depend on
that package, so pointing the entry at the root would describe a package with
no plugin manifest of its own.

## Pre-submission checklist (CI checks these)

- [ ] **Repo public on GitHub**, pushed, **older than 1 day**, with **>= 10 commits**.
- [ ] `dsh.bundle` manifest reachable **from the URL the entry points at**
      (`packages/plugin/package.json` declares `dsh.bundle.patch: ./cordis.patch.yml`).
- [ ] A published **release** carrying `dsh-opencode-free-dsh-plugin.tgz`
      (the version-free `latest/download/` path depends on it).
- [ ] Add the GitHub topic **`dsh-plugin`** to the repo (repo page → gear next to About).
- [ ] Either publish to npm (`npm publish --access public` in `packages/plugin`,
      access must be granted for the `@dsh-opencode-free` scope first) **or** rely
      on the release tarball, which needs no registry account.
- [ ] Optional: `screenshots.json` next to `packages/plugin/package.json` with
      1-8 relative image paths for the AppStore-style detail view.

## Steps

```sh
# 1. fork https://github.com/awesome-dsh-plugin/awesome-dsh-plugin
# 2. in the fork:
npm ci
# 3. add data/plugins/ddldxiacan__dsh-opencode-free--packages-plugin.yml
node scripts/generate-readme.mjs
# 4. commit the YAML + both regenerated READMEs, open the PR
```

## PR title

```
Add ddldxiacan/dsh-opencode-free (model)
```

## PR body

```markdown
Adds one entry: `data/plugins/ddldxiacan__dsh-opencode-free--packages-plugin.yml`.

**What it does** — registers a native DSH `LlmAdapter` that streams from
OpenCode Zen's free endpoint (`Authorization: Bearer public`), so the
free models (big-pickle, hy3-free, ...) appear in the model picker without
any API key. Catalog comes from the live `/v1/models` list
intersected with models.dev free-by-metadata, falling back to a disk cache
and a verified static list; the plugin auto-refreshes and writes a health
snapshot to `~/.dsh-opencode-free/adapter-status.json`.

**Install source** — a prebuilt release tarball
(`dsh-opencode-free-dsh-plugin.tgz`), version-free via `releases/latest/download/`.

**Manifest** — `packages/plugin/package.json` declares
`dsh.bundle: { patch: "./cordis.patch.yml" }` (adapter-only; the legacy Go
sidecar lives in `legacy/` and is not shipped).

**Lineage** — independently maintained rename of FishBottle7/opencode2dsh.
Upgrading from the old name migrates saved settings automatically.

- Repo: https://github.com/ddldxiacan/dsh-opencode-free
- License: MIT
```
