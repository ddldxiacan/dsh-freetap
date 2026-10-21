/**
 * ip-pool assembly — builds the ExitPool + RoutingInstaller from plugin
 * config and owns their lifecycle (docs/ip-pool.md IP-1 scope: manual
 * proxies + pinned, both strictness levels; free sources arrive in IP-2).
 *
 * Deliberately lazy about `undici`: the module is only imported when
 * ipPool.enabled is true, so the default install keeps today's dependency
 * surface (pi-ai only).
 *
 * IP-5: the runtime additionally exposes reconfigure() so the settings
 * namespace can hot-apply committed values (docs §5.1) — no restart for any
 * knob, including enabled itself.
 */

import type { DshFreetapConfig } from './config.ts'

import { join } from 'node:path'

import { dataDir } from './data-dir.ts'
import { ExitPool, gradeOf, type ExitNode } from './pool/pool.ts'
import type { UndiciSeam } from './pool/dispatcher.ts'
import type { AdmissionDeps } from './pool/admission.ts'
import { Prober } from './pool/prober.ts'
import { RefillScheduler } from './pool/refill.ts'
import { SubscriptionFetcher } from './pool/subscription-fetcher.ts'
import { SingBoxSupervisor } from './pool/singbox.ts'
import { createRotateDelegate, setRotateDelegate } from './pool/rotate.ts'

/** Parse one manual proxy string into an exit id + protocol, or null.
 *
 * The host part is anchored in BOTH branches and the port is range-checked:
 * the old `/^\[[^\]]+\]|[^:]+:\d{1,5}$/` let `|` split the pattern, so the
 * bracketed-IPv6 branch had no end anchor and no port requirement — `[abc]`,
 * `[2001:db8::1]` and `http://[::1]junk` all parsed "successfully". Every
 * parsed row is seeded into the pool as an already-OK exit, so a mistyped row
 * became a live proxy target that could only fail at dispatch time (and, with
 * latency 0, outranked every real exit in pick()). Same for a port above
 * 65535 and port 0 on the bare-host branch.
 */
export function parseManualProxy(
  entry: string,
): { id: string; protocol: 'http' | 'socks5' } | null {
  const trimmed = entry.trim()
  if (trimmed === '') return null
  const schemeMatch = /^([a-z0-9+.-]+):\/\//i.exec(trimmed)
  const scheme = schemeMatch?.[1]?.toLowerCase()
  const rest = schemeMatch ? trimmed.slice(schemeMatch[0].length) : trimmed
  const match = /^(?:\[[0-9A-Fa-f:.]+\]|[^:[\]]+):(\d{1,5})$/.exec(rest)
  if (!match) return null
  const port = Number(match[1])
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null
  if (scheme !== undefined && scheme !== 'http' && scheme !== 'socks5' && scheme !== 'https' && scheme !== 'socks4' && scheme !== 'socks5h') return null
  const protocol = scheme === 'socks5' || scheme === 'socks4' || scheme === 'socks5h' ? 'socks5' : 'http'
  return { id: trimmed, protocol }
}

/** Build the ExitPool from config (manual proxies + pinned). The pool starts
 *  with unknown health; the periodic/probe layer (IP-2) fills it in. Pinned
 *  nodes are admitted even without admission data — the user vouches for
 *  them (docs/ip-pool.md 3.1/4.5). */
export function buildPoolFromConfig(config: DshFreetapConfig): ExitPool {
  const pool = new ExitPool()
  syncManualExits(pool, config.ipPool, { initial: true })
  return pool
}

/**
 * Reconcile the pool's MANUAL rows and the pin with the committed settings
 * (initial boot AND every live `reconfigure`).
 *
 * Why this exists: the pool was built once at start and `reconfigure` never
 * touched it, so every edit the settings card makes to `manual` or
 * `pinnedExitId` was accepted, reported saved, and silently ignored — adding
 * a proxy, removing one, pinning a line or clearing the pin all left routing
 * exactly as it was. `pool.pin()`/`unpin()` were likewise never called, and
 * the pinned id could only ever be cleared by removing the node, so an old
 * pin survived even a rebuilt manual list.
 *
 * Only `source: 'manual'` rows are ours to add and drop; free/subscription
 * nodes belong to their own layers and are never touched here. A row that
 * survives keeps its measured health/facts (only its `pinned` flag is
 * refreshed), so a save does not throw away probe results.
 */
export function syncManualExits(
  pool: ExitPool,
  ipPool: DshFreetapConfig['ipPool'],
  options: { initial?: boolean } = {},
): void {
  const wanted = new Map<string, { id: string; protocol: 'http' | 'socks5' }>()
  for (const entry of ipPool?.manual ?? []) {
    const parsed = parseManualProxy(entry)
    if (parsed && !wanted.has(parsed.id)) wanted.set(parsed.id, parsed)
  }
  const pinnedRaw = ipPool?.pinnedExitId?.trim() ?? ''
  const pinned = pinnedRaw === '' ? null : parseManualProxy(pinnedRaw)
  // The pin is a routable exit in its own right (3.6): seed it even when the
  // user only filled the pin box.
  if (pinned !== null && !wanted.has(pinned.id)) wanted.set(pinned.id, pinned)

  for (const entry of pool.list()) {
    if (entry.source !== 'manual') continue
    if (!wanted.has(entry.id)) pool.remove(entry.id)
  }

  for (const [id, parsed] of wanted) {
    const isPinned = pinned !== null && pinned.id === id
    const existing = pool.get(id)
    if (existing === undefined) {
      pool.add({
        id,
        protocol: parsed.protocol,
        source: 'manual',
        pinned: isPinned,
        exitIP: '',
        exitLocation: '',
        latencyMs: 0,
        quality: gradeOf(0),
        addedAt: Date.now(),
      })
      pool.markOk(id)
      continue
    }
    if (existing.pinned !== isPinned || existing.protocol !== parsed.protocol) {
      pool.add({ ...existing, protocol: parsed.protocol, pinned: isPinned })
    }
  }

  // Pin state: match the setting exactly, including clearing it. On boot the
  // pin is already correct, but running this unconditionally keeps the two
  // paths identical instead of letting reconfigure drift again.
  if (pinned === null) {
    if (pool.pinnedId !== '') pool.unpin()
  } else {
    pool.pin(pinned.id)
  }
  void options
}

export interface IpPoolRuntime {
  pool: ExitPool
  installer: {
    install(): void
    disable(): void
    dispose(): void
    readonly enabled: boolean
    /** R1 coexistence: why the routing layer deferred (null when active). */
    readonly deferredReason: string | null
  }
  /** Shared probe scheduler (admission + periodic probes + UI-triggered). */
  prober: Prober
  /** Subscription layer (null when no URLs configured). */
  subscriptions: SubscriptionFetcher | null
  /** Free-source refill loop (null when free.enabled false). */
  refill: RefillScheduler | null
  /** Hot-apply one committed settings value onto the live runtime (docs §5.1).
   *  Every knob lands without restart; enabled toggles the dispatcher. */
  reconfigure(next: DshFreetapConfig): Promise<void>
  /** Enqueue a probe of every pool exit against the probe models (bridge
   *  /probe scope 'all', docs §5.3). Returns the queue depth after enqueue. */
  probeAll(): Promise<number>
  /** Enqueue one exit's probe (bridge /probe scope 'exit'). */
  probeExit(exitId: string): Promise<number>
  /** One manual refill round (bridge /probe scope 'refill'). */
  refillNow(): Promise<boolean>
  /** One subscription refresh round (bridge 立即刷新, docs §5.2). */
  refreshSubscriptions(): Promise<void>
  dispose(): Promise<void>
}

/**
 * Assemble the routing stack. Returns null (with a logged reason) when the
 * host has no undici or the pool ends up empty — enabled-but-empty must
 * degrade to today's direct behavior, never a broken dispatcher (3.3).
 *
 * The undici seam is imported once here and threaded to every layer; empty
 * pool does not stop the runtime from existing (reconfigure can add exits
 * later), it only keeps the dispatcher uninstalled.
 */
export async function startIpPool(
  config: DshFreetapConfig,
  logger: { info(message: string): void; warn(message: string): void },
): Promise<IpPoolRuntime | null> {
  const ipPool = config.ipPool ?? {}
  const pool = buildPoolFromConfig(config)

  let undici: UndiciSeam
  try {
    undici = (await import('undici')) as UndiciSeam
  } catch (err) {
    logger.warn(`dsh-freetap: undici unavailable; exit routing disabled (${err instanceof Error ? err.message : String(err)})`)
    return null
  }

  const { RoutingInstaller } = await import('./pool/installer.ts')
  const installer = new RoutingInstaller({
    pool,
    undici,
    proxyHosts: ipPool.proxyHosts,
    logger,
  })

  const admissionDeps: AdmissionDeps = {
    pool,
    undici: undici as unknown as AdmissionDeps['undici'],
    logger,
    blockedCountries: ipPool.free?.blockedCountries,
    smokeModel: (ipPool.probeModels ?? [])[0],
  }
  const probeModels = ipPool.probeModels ?? []
  const prober = new Prober({ pool, maxConcurrentProbes: ipPool.maxConcurrentProbes ?? 3 })

  // Free-source refill loop (docs/ip-pool.md 3.5/4.5, IP-2): periodic state
  // check -> tiered fetch -> admission probes through the Prober queue.
  let refill: RefillScheduler | null = null

  // Subscriptions (docs 1.2 source 3, IP-3/IP-4): pull + parse + trusted
  // smoke; encrypted nodes convert via sing-box when a binary is configured.
  let subscriptions: SubscriptionFetcher | null = null
  let supervisor: SingBoxSupervisor | undefined

  const ensureSupervisor = (): SingBoxSupervisor | undefined => {
    const singboxPath = config.ipPool?.singbox?.path
    if (typeof singboxPath !== 'string' || singboxPath.length === 0) return undefined
    if (supervisor === undefined) {
      supervisor = new SingBoxSupervisor({
        binPath: singboxPath,
        dataDir: join(dataDir(), 'singbox'),
        logger,
      })
    } else {
      supervisor.setBinPath(singboxPath)
    }
    return supervisor
  }

  const ensureSubscriptions = (urls: string[]): SubscriptionFetcher | null => {
    if (urls.length === 0) return null
    if (subscriptions === null) {
      subscriptions = new SubscriptionFetcher(
        { ...admissionDeps, prober, supervisor: ensureSupervisor() },
        { logger },
      )
    }
    subscriptions.setUrls(urls)
    return subscriptions
  }

  /** Apply the config to the live objects (initial start + reconfigure). */
  const applyConfig = (): void => {
    const current = config.ipPool ?? {}
    // The exit table itself: manual rows and the pin follow the saved settings.
    // Without this every manual/pin edit was a silent no-op (see
    // syncManualExits). It runs BEFORE the install decision below so a save
    // that only adds the first manual row also engages routing.
    syncManualExits(pool, current)
    pool.setTargetSize(current.free?.targetSize ?? 20)
    admissionDeps.blockedCountries = current.free?.blockedCountries
    admissionDeps.smokeModel = probeModels[0]
    prober.setMaxConcurrent(current.maxConcurrentProbes ?? 3)
    installer.setProxyHosts?.(current.proxyHosts)

    // Free loop on/off + restart on target change (interval fixed 10min).
    const wantRefill = (current.free?.enabled ?? true) && current.enabled !== false
    if (wantRefill && refill === null) {
      refill = new RefillScheduler(pool, { ...admissionDeps, prober })
      // Auto-install when the first refill lands exits (live-observed
      // 2026-09-09): the free-source pool starts EMPTY, so the initial
      // install() below stays deferred ("no exits configured") and nothing
      // ever retried it — the pool filled up but routing never engaged
      // until the user touched settings (reconfigure). Watch the pool and
      // engage routing the moment the first exit is admitted.
      refill.onAdmitted(() => {
        if (!installer.enabled && current.enabled !== false && pool.snapshot().total > 0) {
          installer.install()
          if (installer.enabled) {
            logger.info('dsh-freetap: first free exits admitted — exit routing engaged')
          }
        }
      })
      refill.start()
    } else if (!wantRefill && refill !== null) {
      refill.stop()
      refill = null
    }

    // Subscription layer: (re)create on URL change, keep the fetcher across
    // refresh-interval edits.
    const urls = current.subscriptions ?? []
    if (urls.length === 0 || current.enabled === false) {
      subscriptions?.stop()
      subscriptions = null
      fetcherActive = false
      return
    }
    const fetcher = ensureSubscriptions(urls)
    if (fetcher !== null) {
      fetcher.setIntervalMs(current.subscription?.refreshMs ?? 30 * 60_000)
      // Applied before start() so the very first refresh already carries the
      // configured UA (airports gate on it — an unlisted one answers 502).
      fetcher.setUserAgent(current.subscription?.userAgent)
      if (fetcher === subscriptions && !fetcherActive) {
        fetcher.start()
        fetcherActive = true
      }
    }
  }

  let fetcherActive = false
  if (pool.snapshot().total > 0) {
    installer.install()
  } else {
    logger.warn('dsh-freetap: ipPool enabled but no exits configured; staying direct until settings add exits')
  }
  applyConfig()

  const probeAll = async (): Promise<number> => {
    const models = probeModels.length > 0 ? probeModels : ['big-pickle']
    const { admitCandidate, admitTrusted } = await import('./pool/admission.ts')
    const tasks = pool.list().map((entry): import('./pool/prober.ts').ProbeTask => ({
      exitId: entry.id,
      kind: 'probe-all',
      run: async () => {
        for (const model of models) {
          // Free exits re-run the full candidate chain (echo→tunnel→smoke) —
          // their facts may have drifted; trusted exits run the smoke only
          // (docs §4.5 manual/subscription path). Pinned rides the trusted
          // path so a blocked echo endpoint never evicts the user's line.
          // The model rides the CALL, never the shared deps: probe workers
          // run concurrently, so a mutated deps.smokeModel was clobbered by
          // another worker and the smoke ran against a different model than
          // the health/ban bookkeeping below recorded.
          const verdict = entry.source === 'free'
            ? await admitCandidate(admissionDeps, {
              address: entry.id,
              protocol: entry.protocol,
              source: 'free',
            }, { smokeModel: model })
            : await admitTrusted(admissionDeps, {
              address: entry.id,
              protocol: entry.protocol,
              source: entry.source === 'manual' ? 'manual' : 'subscription',
            }, { pinned: entry.pinned, smokeModel: model, previous: { exitIP: entry.exitIP, exitLocation: entry.exitLocation, latencyMs: entry.latencyMs, quality: entry.quality } })
          if (verdict.admitted && verdict.node) {
            // Refresh the node's facts (admission re-measured them).
            pool.add({ ...entry, ...verdict.node, pinned: entry.pinned })
            if (verdict.limited) pool.markLimited(entry.id)
            else if (verdict.degraded) pool.markDeadStrike(entry.id)
            else pool.markOk(entry.id, model)
          } else {
            pool.markDeadStrike(entry.id)
            break
          }
        }
      },
    }))
    if (tasks.length === 0) return 0
    void prober.enqueueAll(tasks).catch(() => {})
    return tasks.length
  }

  const probeExitTask = (exitId: string, entry: import('./pool/pool.ts').ExitNode & { health: unknown; bans: unknown }): import('./pool/prober.ts').ProbeTask => ({
    exitId,
    kind: 'probe-exit',
    run: async () => {
      const models = probeModels.length > 0 ? [...probeModels] : ['big-pickle']
      const { admitCandidate, admitTrusted } = await import('./pool/admission.ts')
      for (const model of models) {
        const verdict = entry.source === 'free'
          ? await admitCandidate(admissionDeps, { address: entry.id, protocol: entry.protocol, source: 'free' }, { smokeModel: model })
          : await admitTrusted(admissionDeps, {
            address: entry.id,
            protocol: entry.protocol,
            source: entry.source === 'manual' ? 'manual' : 'subscription',
          }, { pinned: entry.pinned, smokeModel: model, previous: { exitIP: entry.exitIP, exitLocation: entry.exitLocation, latencyMs: entry.latencyMs, quality: entry.quality } })
        if (verdict.admitted && verdict.node) {
          pool.add({ ...entry, ...verdict.node, pinned: entry.pinned })
          if (verdict.limited) pool.markLimited(entry.id)
          else if (verdict.degraded) pool.markDeadStrike(entry.id)
          else pool.markOk(entry.id, model)
        } else {
          pool.markDeadStrike(entry.id)
          break
        }
      }
    },
  })

  const probeExit = async (exitId: string): Promise<number> => {
    const entry = pool.list().find((node) => node.id === exitId)
    if (!entry) return 0
    await prober.enqueue(probeExitTask(exitId, entry))
    return 1
  }

  // Adapter-layer rotate delegate (docs §3.4/§8.1, IP-7): lets zen-adapter
  // restart a pre-content stream on a fresh exit instead of surfacing the
  // intermediate error to the host's retry budget.
  setRotateDelegate(createRotateDelegate(pool, { maxAttempts: config.ipPool?.maxRotateAttempts ?? 3 }))

  return {
    pool,
    installer,
    prober,
    get subscriptions() { return subscriptions },
    get refill() { return refill },
    async reconfigure(next: DshFreetapConfig) {
      const wasEnabled = config.ipPool?.enabled !== false
      // splice the new ipPool section into the config object the runtime closes over
      config.ipPool = next.ipPool
      probeModels.length = 0
      probeModels.push(...(next.ipPool?.probeModels ?? []))
      const enable = next.ipPool?.enabled !== false
      applyConfig()
      // rotate ceiling is live-tunable (settings page) — rebuild the delegate
      setRotateDelegate(createRotateDelegate(pool, { maxAttempts: next.ipPool?.maxRotateAttempts ?? 3 }))
      // Dispatcher install state follows enabled + pool occupancy. Every
      // enable flip re-attempts install: when another dispatcher-level plugin
      // owned the slot (R1 deferral), its unload is picked up here without a
      // restart.
      if (enable && !installer.enabled && pool.snapshot().total > 0) {
        installer.install()
        if (installer.enabled) {
          logger.info('dsh-freetap: exit routing recovered — global dispatcher is free again (R1)')
        }
      } else if (!enable && installer.enabled) {
        installer.disable()
      }
      if (wasEnabled !== enable) {
        logger.info(`dsh-freetap: ip pool ${enable ? 'enabled' : 'disabled'} via settings (live)`)
      }
    },
    probeAll,
    probeExit,
    async refillNow() {
      // false = a round was already running and this request was dropped;
      // the bridge reports that instead of claiming a refill happened.
      return refill !== null ? refill.tick() : false
    },
    async refreshSubscriptions() {
      await subscriptions?.refreshNow()
    },
    async dispose() {
      setRotateDelegate(null)
      subscriptions?.stop()
      refill?.stop()
      installer.dispose()
    },
  }
}
