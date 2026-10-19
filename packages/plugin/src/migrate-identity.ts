/**
 * One-time identity migration: `opencode2dsh` -> `dsh-opencode-free`.
 *
 * This project was renamed. Two pieces of user state carry the OLD name and
 * would silently disappear on upgrade:
 *
 *  1. the data directory `~/.opencode2dsh/` (catalog cache, health snapshot,
 *     sing-box runtime, sidecar token + agent-config.json), and
 *  2. the persisted `ipPool` document, which DSH keys by the Loader entry id.
 *     The entry id is now `dsh-opencode-free`, so a saved pool configuration
 *     (manual proxies, subscription URLs, probe settings, geo blocklist, …)
 *     sits under a key nothing reads any more.
 *
 * WHY THE SETTINGS HALF READS A FILE
 * ----------------------------------
 * The obvious seam — `settings.describe()` / `settings.get(ns)` — cannot see
 * the retired namespace, by construction:
 *
 *  - `SettingsProvider.describe()` maps over `this.registrations`, and it
 *    returns each namespace's RESOLVED value (schema defaults + composition
 *    `base` + user section). After the rename the plugin registers only
 *    `dsh-opencode-free`, so `opencode2dsh` is absent from that list.
 *  - `get(ns)` is the same map lookup: `undefined` for an unregistered ns.
 *  - `mutate(ns, …)` throws `settings namespace "…" is not registered`.
 *
 * So the only place the old section survives is the settings DOCUMENT the
 * provider persists. This module reads and rewrites that file directly, and
 * treats every failure as "skip the migration" — it must never cost the
 * deployment its provider.
 *
 * WHAT IS SAFE ABOUT REWRITING THE DOCUMENT
 * ----------------------------------------
 * The file is YAML keyed by namespace (`llm-pi-ai:`, `ui-onboarding:`, …). The
 * migration only touches two keys: it copies the retired section's missing
 * leaves into the current one and leaves the old section in place. The write is
 * atomic (tmp + rename), and the file is left byte-identical when there is
 * nothing to do.
 *
 * TIMING: the copied section takes effect on the NEXT start. The Loader resolves
 * the entry's `ipPool` volatile reference while composing this boot, so the
 * value this process reads was fixed before the migration ran. The data
 * directory half, by contrast, is used lazily by the cache/catalog code and is
 * therefore live immediately.
 *
 * Idempotence: the copy only writes keys the current namespace is still
 * missing, so re-running is a no-op once the user has the settings — which also
 * covers the next start, where the migration runs again and finds its own work
 * already applied.
 */

import { copyFile, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

/** The retired identity, kept verbatim: it is what exists on disk. */
export const LEGACY_NAME = 'opencode2dsh'
export const CURRENT_NAME = 'dsh-opencode-free'

/** `~/.opencode2dsh` — the retired data directory. */
export function legacyDataDir(home: string = homedir()): string {
  return join(home, `.${LEGACY_NAME}`)
}

/** `~/.dsh-opencode-free` — the current data directory. */
export function currentDataDir(home: string = homedir()): string {
  return join(home, `.${CURRENT_NAME}`)
}

/**
 * The settings document, as DSH persists it: one YAML file in the harness
 * home, keyed by namespace.
 */
export function settingsDocumentPath(home: string = homedir()): string {
  return join(home, '.dsh', 'settings.yaml')
}

export interface MigrationLogger {
  info(message: string): void
  warn(message: string): void
}

/** True when the path exists (any type). */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Plain objects only; arrays and scalars are copied by value. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Copy the retired data directory into the current one.
 *
 * Files only, no recursion: the directory holds flat artifacts
 * (`agent-config.json`, `agent-token.txt`, the models.dev cache, the health
 * snapshot) plus a `singbox/` subtree that is regenerated on demand, so a
 * missing nested file is not worth a failure.
 *
 * The old directory is COPIED, never moved or deleted: a downgrade keeps
 * working, and a half-finished run can simply be repeated.
 *
 * Returns the number of files copied.
 */
export async function migrateDataDir(
  logger: MigrationLogger,
  deps: { home?: string } = {},
): Promise<number> {
  const from = legacyDataDir(deps.home)
  const to = currentDataDir(deps.home)
  if (!(await exists(from))) return 0
  if (await exists(to)) return 0

  let copied = 0
  try {
    await mkdir(to, { recursive: true })
    for (const entry of await readdir(from, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      try {
        await copyFile(join(from, entry.name), join(to, entry.name))
        copied++
      } catch (err) {
        logger.warn(`${CURRENT_NAME}: could not migrate ${entry.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    logger.info(`${CURRENT_NAME}: migrated ${copied} file(s) from ${from} to ${to}`)
  } catch (err) {
    logger.warn(`${CURRENT_NAME}: data directory migration skipped: ${err instanceof Error ? err.message : String(err)}`)
  }
  return copied
}

/**
 * Keys present in `legacy` that `current` does not define yet.
 *
 * Recursive on plain objects so a partially-configured new section (say, the
 * user already enabled the pool) still receives the untouched siblings. Arrays
 * are leaves: a saved list fills an absent list, but never overwrites one the
 * user has since edited.
 */
export function missingKeys(
  legacy: unknown,
  current: unknown,
): Record<string, unknown> | undefined {
  if (!isPlainObject(legacy)) return undefined
  const source = legacy
  const target = isPlainObject(current) ? current : {}
  const diff: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (!(key in target) || target[key] === undefined) {
      diff[key] = value
      continue
    }
    const nested = missingKeys(value, target[key])
    if (nested !== undefined && Object.keys(nested).length > 0) diff[key] = nested
  }
  return Object.keys(diff).length > 0 ? diff : undefined
}

/** Merge `patch` into `base` without dropping siblings (plain objects only). */
export function mergeDeep(base: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const target: Record<string, unknown> = isPlainObject(base) ? { ...base } : {}
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(target[key])) {
      target[key] = mergeDeep(target[key], value)
    } else {
      target[key] = value
    }
  }
  return target
}

/**
 * Copy the retired namespace's section into the current one, inside the
 * settings document.
 *
 * Returns the number of leaf keys copied (0 when there was nothing to do).
 * Never throws: a malformed document, an absent file, or a read-only home is
 * logged and skipped.
 */
export async function migrateSettingsDocument(
  logger: MigrationLogger,
  deps: { home?: string } = {},
): Promise<number> {
  const path = settingsDocumentPath(deps.home)
  if (!(await exists(path))) return 0

  let document: unknown
  try {
    document = parseYaml(await readFile(path, 'utf8'))
  } catch (err) {
    logger.warn(`${CURRENT_NAME}: settings document is not readable YAML; migration skipped: ${err instanceof Error ? err.message : String(err)}`)
    return 0
  }
  if (!isPlainObject(document)) return 0

  const legacy = document[LEGACY_NAME]
  if (!isPlainObject(legacy)) return 0

  const diff = missingKeys(legacy, document[CURRENT_NAME])
  if (diff === undefined) return 0

  const next: Record<string, unknown> = {
    ...document,
    [CURRENT_NAME]: mergeDeep(document[CURRENT_NAME], diff),
  }

  try {
    // Atomic in-place rewrite: a crash mid-write must not truncate the
    // document that every other plugin's settings live in.
    const tmp = `${path}.${CURRENT_NAME}-migrate.tmp`
    await mkdir(dirname(path), { recursive: true })
    await writeFile(tmp, stringifyYaml(next), 'utf8')
    await rename(tmp, path)
  } catch (err) {
    logger.warn(`${CURRENT_NAME}: settings document migration skipped: ${err instanceof Error ? err.message : String(err)}`)
    return 0
  }

  const copied = countLeaves(diff)
  logger.info(`${CURRENT_NAME}: copied ${copied} saved setting(s) from the "${LEGACY_NAME}" section of ~/.dsh/settings.yaml`)
  return copied
}

/** Number of leaf values in a diff object. */
function countLeaves(value: Record<string, unknown>): number {
  let total = 0
  for (const entry of Object.values(value)) {
    if (isPlainObject(entry) && Object.keys(entry).length > 0) total += countLeaves(entry)
    else total++
  }
  return total
}

/**
 * Mark the migration as done, so a future downgrade/upgrade cycle does not
 * re-copy state the user has since changed. The marker lives in the current
 * data directory, which is why the directory migration runs first.
 */
export async function writeMigrationMarker(deps: { home?: string } = {}): Promise<void> {
  const dir = currentDataDir(deps.home)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'migrated-from.json'),
    JSON.stringify({ from: LEGACY_NAME, at: new Date().toISOString() }, null, 2),
    'utf8',
  )
}

/**
 * Run both halves of the migration once.
 *
 * Never throws: every step logs and moves on, because this runs on the startup
 * path of the deployment's only free provider.
 */
export async function runIdentityMigration(
  deps: { home?: string } = {},
  logger: MigrationLogger,
): Promise<void> {
  await migrateDataDir(logger, { home: deps.home })
  await migrateSettingsDocument(logger, { home: deps.home })
  await writeMigrationMarker({ home: deps.home }).catch(() => {})
}
