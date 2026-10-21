# Changelog

## 0.5.1

### Changed

- **The install needs no extra flags any more.** `dsh plugin add <tarball>` now
  succeeds on a clean machine under pnpm's default strict build policy, and the
  Web UI's Install dialog no longer stops at an "install scripts need
  permission" panel.

  Root cause: the package depended on the whole `@earendil-works/pi-ai`
  provider matrix at runtime, and two of its transitive dependencies
  (`@google/genai`, `protobufjs`) declare install scripts. pnpm blocks those by
  default and turns the block into a hard failure:

  ```
  Error: ERR_PNPM_IGNORED_BUILDS
    × adding a new package
    ╰─▶ Ignored build scripts: @google/genai@1.52.0, protobufjs@7.6.6
  ```

  The trap was what happened next: pnpm had **already written the dependency**
  into the profile's `package.json`, but DSH only registers a package as a
  profile *bundle* when the run exits 0. So the plugin sat installed in
  `node_modules`, never loaded, and the model picker stayed empty with nothing
  in the output explaining why.

  Fixed at the source instead of in the instructions: the wire layer is now
  **bundled into the shipped `lib/`** (`tsdown.config.ts`, `noExternal`), so
  those packages are not installed at all. `@earendil-works/pi-ai` moved to
  `devDependencies`; it is a build input, not a runtime dependency.

### Fixed

- **Install footprint dropped from ~99 packages to 7.** The published package
  now depends only on `yaml`, `undici`, `partial-json` and
  `@deepseek-ai/schemastery` — none of which run install scripts. `partial-json`
  is declared explicitly, because it used to arrive as a `pi-ai` transitive
  dependency and is still imported at runtime.

  Verified end to end on a clean `HOME` with an empty pnpm store: bare
  `dsh plugin --profile web add <tarball>` → exit 0, plugin registered under
  `dsh.profile.bundles`, DSH boots and the provider reports 86 models / 9
  exposed / no error. Full suite still 316/316.

## 0.5.0

First release under the name **dsh-freetap**. The project is published fresh
under this name: the package, provider id, settings entry, data directory,
IP-pool bridge prefix, release asset names and repository all use `dsh-freetap`,
and no artifact under any previous name is published or supported from here.

Earlier development history (releases under a previous name) is not carried in
this file; it remains in the repository's git history.

### Highlights

- Registers a native DSH `LlmAdapter` that streams directly from OpenCode Zen's
  anonymous free lane — no API key, no child process, no local port.
- Live model catalog (upstream list ∩ models.dev free-by-metadata) with an
  offline cache and a verified static fallback; refreshes in the background and
  writes a health snapshot to `~/.dsh-freetap/adapter-status.json`.
- Requests carry the OpenCode CLI user agent and its session/request/project
  correlation headers, derived per conversation.
- Reasoning-effort ladders where model metadata declares them; image input
  accepted exactly where models.dev (or the live-verified vision family) says
  the lane supports it.
- Optional IP-pool exit routing (manual proxies, subscriptions, probing, geo
  blocklist) with a settings page under **Settings → Plugins**.
- Upstream failures arrive in DSH as classified finish reasons (rate limit,
  auth, timeout, transport) and retries stay owned by DSH.

### Notes

- Package name is unscoped (`dsh-freetap`): no npm scope or org is needed, and
  the release tarball and `npm` install paths use the identical specifier.
- Release assets are `dsh-freetap.tgz` (version-free, for first installs) and
  `dsh-freetap-<version>.tgz` (tag-scoped, the update path — pnpm pins a
  resolved tarball URL, so only a URL that differs per release re-resolves).
- The data directory is `~/.dsh-freetap/`, built through a single module
  (`src/data-dir.ts`) so the adapter, the ip-pool assembly and the legacy
  sidecar path cannot drift apart.
