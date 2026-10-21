# Changelog

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
