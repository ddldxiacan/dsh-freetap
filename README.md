<div align="center">

# dsh-opencode-free

**Free OpenCode Zen models, natively inside DSH (DeepSeek Harness).**

No API key. No registration. No extra process.

[![npm](https://img.shields.io/npm/v/@dsh-opencode-free%2Fdsh-plugin)](https://www.npmjs.com/package/@dsh-opencode-free/dsh-plugin)
[![license](https://img.shields.io/npm/l/@dsh-opencode-free%2Fdsh-plugin)](https://github.com/ddldxiacan/dsh-opencode-free/blob/master/LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](https://nodejs.org)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-blue)](https://github.com/ddldxiacan/dsh-opencode-free)

English | [简体中文](README.zh-CN.md)

</div>

---

dsh-opencode-free registers a native DSH `LlmAdapter` that streams directly from
[OpenCode Zen](https://opencode.ai/zen)'s **anonymous free lane** — the same
models OpenCode's own CLI uses without an account, served to your DSH model
picker as a regular provider called `dsh-opencode-free`.

Requests leave your machine looking exactly like traffic from the OpenCode
CLI (same user agent, same correlation headers), and the model catalog stays
fresh through a three-tier fallback chain. There is nothing to log into and
nothing to host.

> **Upgrading from `opencode2dsh`?** This project was renamed. The plugin now
> installs as `@dsh-opencode-free/dsh-plugin` with the provider, settings entry
> and data directory all under the new name. Your saved IP-pool settings and the
> old `~/.opencode2dsh` cache are copied once on first start — see
> [Renamed from opencode2dsh](#renamed-from-opencode2dsh).

## Highlights

- **Zero credential, zero setup** — the anonymous lane needs no key; install, restart, chat
- **Native adapter, no sidecar** — one npm package, no child process, no binary, no local port (the legacy Go sidecar is not part of the published package; see `legacy/`)
- **CLI-identical disguise** — requests carry the OpenCode CLI user agent and its session/request/project header set, derived per conversation
- **Selectable thinking levels** — reasoning-capable free models expose an effort picker in DSH's model selector (declared ladders where the model metadata provides them, Off/Minimal/Low/Medium/High otherwise); Responses-only `muse-spark-*` models expose only upstream-supported effort levels, and no selection keeps the provider default
- **Image input where it is declared** — image attachments are accepted for every model whose [models.dev](https://models.dev) entry lists `image` in `modalities.input`, and refused for the ones that declare `text` only; models.dev being silent falls back to the live-verified vision family
- **Live catalog with a fallback chain** — live upstream list ∩ free-by-metadata, falling back to offline cache and a verified static list
- **Self-healing** — fast startup retries, periodic refresh, and a written health snapshot for diagnostics
- **Proper error surfaces** — upstream failures (rate limit, auth, timeout, transport) arrive in DSH as classified finish reasons, and retries stay owned by DSH

## Install

Installs from a prebuilt release, so no build step and no toolchain is needed.
**Read the three steps in order** — doing the install before step 2 fails
silently, in a way that looks like success (see below).

**1. Make sure the profile exists.** Any `dsh plugin` command initializes it:

```sh
dsh plugin --profile web list
```

**2. Approve two build scripts *before* the first install.** They are
`@google/genai` and `protobufjs`, pulled in transitively by
`@earendil-works/pi-ai`; pnpm blocks dependency build scripts by default. Append
this to the profile's `pnpm-workspace.yaml`
(`~/.dsh/profiles/web/pnpm-workspace.yaml`, under `%USERPROFILE%\.dsh\profiles\web\`
on Windows):

```yaml
allowBuilds:
  '@google/genai': false
  protobufjs: false
```

`false` keeps the scripts disabled — it records the decision pnpm is waiting for,
which is all that is needed. (Upstream ships the same two as `false`.)

**3. Install:**

```sh
dsh plugin --profile web add https://github.com/ddldxiacan/dsh-opencode-free/releases/latest/download/dsh-opencode-free-dsh-plugin.tgz
```

The link is version-free on purpose, so it keeps tracking the newest release.

### Why step 2 comes first

Skip it and the first install stops at `ERR_PNPM_IGNORED_BUILDS` — but pnpm has
already written the dependency into the profile's `package.json`. DSH registers a
newly installed package as a profile *bundle* only when that pnpm run exits 0
**and** the package is a new dependency. So the retry is no longer "new", the
registration is skipped, and the run exits **0** with the plugin present on disk
in `node_modules` but never added to `dsh.profile.bundles` — meaning it never
loads and no models appear. Nothing in the output says so.

If you have already hit that, recover with a remove and re-add:

```sh
dsh plugin --profile web remove @dsh-opencode-free/dsh-plugin
dsh plugin --profile web add https://github.com/ddldxiacan/dsh-opencode-free/releases/latest/download/dsh-opencode-free-dsh-plugin.tgz
```

To confirm the plugin is really registered, check that the profile's
`package.json` lists `@dsh-opencode-free/dsh-plugin` under `dsh.profile.bundles` — not
just under `dependencies`.

### Other ways to install

**In the Web UI**: **Settings → Plugins → Install**, and paste the same tarball
URL. The Web page writes the same kind of approval and has its own bundle
selection; the CLI steps above are the path verified here.

**From GitHub directly** (no registry involved):

```sh
dsh plugin --profile web add github:ddldxiacan/dsh-opencode-free
```

This works because the repository root *is* the installable plugin: it carries
the `dsh` manifest, and the built output is committed under
`packages/plugin/lib/`. A git install cannot run a build — pnpm blocks prepare
scripts for git dependencies — so shipping the build is what makes this path
work. Pinning a tag is recommended for stability:

```sh
dsh plugin --profile web add github:ddldxiacan/dsh-opencode-free#v0.4.0
```

**From npm** (once the package is published):

```sh
dsh plugin --profile web add @dsh-opencode-free/dsh-plugin
```

**Verify**: restart `dsh web`, open the model picker, and pick a model from
the **dsh-opencode-free** group.

### Updating

Pick the source you installed from; each updates in place:

```sh
# release tarball (also what re-running the install URL does)
dsh plugin --profile web add https://github.com/ddldxiacan/dsh-opencode-free/releases/latest/download/dsh-opencode-free-dsh-plugin.tgz

# git install: follow master
dsh plugin --profile web add github:ddldxiacan/dsh-opencode-free

# npm install
dsh plugin --profile web add @dsh-opencode-free/dsh-plugin@latest
```

Then restart DSH. To confirm the new version landed, compare the profile's
`node_modules/<pkg>/package.json` with the release you expected, and check the
health snapshot at `~/.dsh-opencode-free/adapter-status.json`.

If an update ever leaves the plugin installed but not loaded, it is the
`ERR_PNPM_IGNORED_BUILDS` trap described above: remove and re-add, so the
package counts as new and DSH registers it as a bundle.

Requires DSH (DeepSeek Harness) 0.1.7 or newer with a web profile (the IP 池
settings page rides the 0.1.7 Plugins page contract); Node.js ≥ 20 (already
present if DSH runs); outbound HTTPS to `opencode.ai` and `models.dev`.

## Configuration

Defaults work out of the box. Override via the profile's `cordis.patch.yml`.
The `name` must be the package you installed as: `dsh-opencode-free` for a git
install, `@dsh-opencode-free/dsh-plugin` for the tarball or npm.

```yaml
- id: dsh-opencode-free
  name: dsh-opencode-free   # or '@dsh-opencode-free/dsh-plugin'
  config:
    mode: adapter        # adapter (default) | sidecar
    providerId: dsh-opencode-free
    refreshSeconds: 300  # catalog refresh cadence
```

| Option | Default | Description |
| --- | --- | --- |
| `mode` | `adapter` | `adapter`: native LlmAdapter streaming straight from Zen. `sidecar`: legacy local-agent mode, not bundled — build the agent from `legacy/agent` and pass `agentPath`. |
| `providerId` | `dsh-opencode-free` | Provider name shown in DSH. |
| `refreshSeconds` | `300` | Live catalog refresh interval. Pricing metadata refreshes every 24 h. |
| `agentPath` | auto-resolved | Sidecar only: path to the agent binary. |
| `agentArgs` | — | Sidecar only: extra CLI args for the agent. |
| `restartDelayMs` / `restartMaxDelayMs` / `maxConsecutiveCrashes` | `1000` / `60000` / `5` | Sidecar only: restart backoff and circuit breaker. |
| `firstEventMs` / `bodyIdleMs` / `responsesBodyIdleMs` | `30000` / `120000` / `300000` | Adapter only, plugin 0.3.7+: stream-liveness watchdogs, in ms (integers from `1` to `600000`). Time to the first stream event, mid-response body silence, and the body-idle floor for Responses models (`muse-spark-*`). Increase `firstEventMs` for slow cold starts. Unset keeps the defaults; restart DSH after editing. |

## How it works

```
DSH session
   │  harness chunks (block-start / text-delta / usage / finish …)
   ▼
ZenAdapter (registered LlmAdapter)
   │  pi-ai openai-completions stream (chat models)
   │  pi-ai openai-responses stream (`muse-spark-*`, Responses-only on Zen)
   ▼
https://opencode.ai/zen/v1        ← Authorization: Bearer public
   with CLI-identical headers:
     user-agent: opencode/…
     x-opencode-client, x-opencode-session, x-session-affinity,
     X-Session-Id, x-opencode-request, x-opencode-project
```

- **Session correlation** — session/project ids are SHA-256 derived from the
  conversation's first user turn (stable per conversation, non-reversible),
  and each request gets a fresh random id, mirroring the CLI.
- **Catalog fallback chain** — S1: live `GET /v1/models`; S2: models.dev
  pricing metadata decides "free"; S3: a compile-time verified static list.
  A disk cache (~7-day TTL) covers upstream outages.
- **Resilience** — the adapter registers immediately at startup; if the first
  catalog fetch races your network (VPN/TUN reconnects, DNS), the plugin
  retries on a short cadence (~1 min) before settling into the periodic
  refresh.
- **Sidecar mode** (`mode: sidecar`, legacy) — spawns a local Go agent (a
  single-tenant port of [opencode2api](https://github.com/jasonxu114514/opencode2api))
  on `127.0.0.1:<random>`, token-authenticated, and registers a standard
  `llm-pi-ai` route. **Not part of the published package**; build it from
  `legacy/agent` (`go build ./cmd/agent`) and point `agentPath` at the binary.

## Health & troubleshooting

The plugin writes a health snapshot after every refresh round:

```
~/.dsh-opencode-free/adapter-status.json
```

```json
{
  "status": "ready",
  "total": 64,
  "exposed": 9,
  "lastError": "",
  "writtenAt": "2026-08-29T07:01:54.915Z"
}
```

| Symptom | Likely cause & fix |
| --- | --- |
| `403 FreeTierError` / "OpenCode's free tier can only be used from within OpenCode" | The upstream restricts free-tier clients. The plugin preserves the explanation instead of reporting an invalid API key. Use the supported OpenCode client or an official API service. |
| Boot screen shows `Failed to load plugins … list slot "plugins.item" requires options.id`, or the IP 池 entry has no configuration page | Your DSH predates the 0.1.7 Plugins page contract. Upgrade DSH to 0.1.7 (latest recommended). On 0.1.6 and older the page never mounts (it is gated on `configForms.whileServed`) — model routing is unaffected. |
| DSH 0.1.7/0.2 cannot start after plugin installation (`pending … settingsScope`) | Upgrade the plugin to 0.3.5. On DSH 0.2, configure IP pooling through the installed dsh-opencode-free row on the Plugins page. |
| Only 3 models | Startup fetch raced your network; retries land within ~1 min. Check `adapter-status.json` for `lastError`. |
| `lastError: "fetch failed"` persisting | Outbound HTTPS to `opencode.ai` blocked; check proxy/VPN rules. |
| Rate-limit errors in chat (`429 … Endpoint is unavailable`) | The anonymous lane is quota-per-IP and free models are contended. Since the fix for [#51](https://github.com/FishBottle7/opencode2dsh/issues/51) the plugin's provider retry policy rides out 429 bursts silently (8 retries, ~1s→20s backoff, ≈90s worst case per step) instead of surfacing them; when contention still wins, lower the reasoning effort, pick a less contended `-free` model, or enable IP pooling (multi-exit rotation) on the plugin settings page. |
| Output limit reached after reasoning with no answer | Plugin 0.3.6 retries once with thinking Off when the model supports it. Any answer text or tool-call event prevents replay. The retry preserves the original output cap and may still fail; both requests' usage is counted. Models without Off, including Muse, require a manual change of settings or model. |
| Muse reports `REGION_BLOCKED` / "This model is not available in your country" | Zen has rejected the current network region for this model. Plugin 0.3.5 preserves that explanation; older versions mislabeled the same 403 as an invalid API key. The anonymous lane does not need a personal key. Use a model available in your region. |
| Connection error to `127.0.0.1:*` | A stale sidecar route shadows the adapter; plugin ≥ 0.2.1 removes it at startup. |
| Install fails with `ERR_PNPM_IGNORED_BUILDS` | A transitive dependency of `pi-ai` (`@google/genai`, `protobufjs`) has build scripts that are not needed at runtime. Approve-or-decline them via the plugin market, or set both to `false` under `allowBuilds:` in the profile's `pnpm-workspace.yaml`. |

## Renamed from opencode2dsh

This project used to be called **opencode2dsh**. The rename is complete: the npm
package, the DSH provider id, the settings entry and the data directory all use
the new name `dsh-opencode-free`.

Upgrading is automatic. On the first start after the update the plugin copies
your state from the old name, once, without deleting anything:

| State | Old location | New location |
| --- | --- | --- |
| Cache, health snapshot, sidecar token | `~/.opencode2dsh/` | `~/.dsh-opencode-free/` |
| Saved IP-pool settings | `opencode2dsh:` section of `~/.dsh/settings.yaml` | `dsh-opencode-free:` section |

Two things the migration deliberately does **not** do:

- **It never deletes or moves the old state.** A downgrade keeps working, and a
  failed migration can simply be retried on the next start.
- **It never overwrites what you set under the new name.** Only keys missing
  from the new section are copied; anything already configured there wins.

After upgrading you will see the provider as **dsh-opencode-free** in the model
picker. **Saved IP-pool settings appear on the second start**: the Loader
resolves the entry's volatile `ipPool` value while composing a boot, so a copy
made during that boot is read on the next one. The cache and health files take
effect immediately. A deployment that cut over before this rename existed may
still list a `opencode2dsh` entry under DSH's **Settings → Plugins**; remove that
stale entry (an orphan `opencode2dsh` provider route left by a sidecar install is
swept automatically at startup).

If you prefer to start clean rather than migrate, delete `~/.opencode2dsh/` and
the `opencode2dsh:` section of `~/.dsh/settings.yaml` before upgrading; the
plugin then starts with defaults.

## Security

- No secrets involved: the anonymous lane's key is the literal string `public`; nothing is stored, nothing telemetry.
- Install paths restricted to `lib/` only; no build scripts run from dependencies.
- All requests go directly from your machine to `opencode.ai` / `models.dev`.

## Development

```sh
git clone https://github.com/ddldxiacan/dsh-opencode-free.git
cd dsh-opencode-free/packages/plugin
pnpm install
pnpm typecheck && pnpm test
pnpm build                    # bundle to lib/
```

The legacy Go sidecar lives in `legacy/agent` (`go test ./...`). Architecture
notes and the porting record live in `docs/`.

Releasing: `pnpm pack` in `packages/plugin` (prepack builds and syncs docs).

## Acknowledgments

- [**opencode2dsh**](https://github.com/FishBottle7/opencode2dsh) by
  [@FishBottle7](https://github.com/FishBottle7) — the upstream project this one
  was forked from and is renamed after. Its architecture, catalog fallback chain
  and request-disguise work are the foundation of this fork; issue numbers cited
  above refer to that repository.
- [**opencode2api**](https://github.com/jasonxu114514/opencode2api) by
  [@jasonxu114514](https://github.com/jasonxu114514) — the legacy Go sidecar
  in `legacy/agent` is a port of its anonymous-lane implementation, and the
  catalog fallback chain and request-disguise details are derived from it.
  This project stands on its shoulders.
- [OpenCode](https://opencode.ai) — for running the free anonymous Zen lane.
- [@earendil-works/pi-ai](https://www.npmjs.com/package/@earendil-works/pi-ai) — the wire layer used by adapter mode.
- [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) and the
  [dsh-market](https://github.com/dsh-market/dsh-market) community.

## Friends

<div align="center">

**[LinuxDo](https://linux.do)** — 新的理想型社区 / a new ideal community

</div>

## License

[MIT](./LICENSE) © 2026 ddldxiacan, based on opencode2dsh © FishBottle7
