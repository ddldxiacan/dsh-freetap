/**
 * Rename carry-over tests: `opencode2dsh` -> `dsh-opencode-free`.
 *
 * The rename touches two pieces of persisted user state — the data directory
 * and the settings document section — so these tests pin the properties that
 * make the migration safe to ship:
 *
 *  - the retired state is COPIED, never moved or deleted (a downgrade works);
 *  - the migration is idempotent and never clobbers a value the user already
 *    set under the new name;
 *  - the settings half reads the DOCUMENT, because after the rename the old
 *    namespace is no longer registered and describe()/get() cannot see it;
 *  - nothing here throws: a broken migration must never cost the provider.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import {
  CURRENT_NAME,
  LEGACY_NAME,
  mergeDeep,
  migrateDataDir,
  migrateSettingsDocument,
  missingKeys,
  runIdentityMigration,
  settingsDocumentPath,
} from '../src/migrate-identity.ts'

function logger() {
  const lines: Array<[string, boolean, string]> = []
  return {
    lines,
    info: (m: string) => { lines.push(['info', true, m]) },
    warn: (m: string) => { lines.push(['warn', false, m]) },
  }
}

/** A harness home with an optional settings document. */
async function home(doc?: string) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-opencode-free-mig-'))
  if (doc !== undefined) {
    await mkdir(join(dir, '.dsh'), { recursive: true })
    await writeFile(settingsDocumentPath(dir), doc)
  }
  return dir
}

test('the retired identity is spelled out literally: it is what exists on disk', () => {
  assert.equal(LEGACY_NAME, 'opencode2dsh')
  assert.equal(CURRENT_NAME, 'dsh-opencode-free')
})

test('migrateDataDir copies the old data directory once and never deletes it', async () => {
  const dir = await home()
  const log = logger()
  try {
    const from = join(dir, `.${LEGACY_NAME}`)
    await mkdir(join(from, 'singbox'), { recursive: true })
    await writeFile(join(from, 'adapter-status.json'), '{"status":"ready"}')
    await writeFile(join(from, 'agent-token.txt'), 'tok\n')
    await writeFile(join(from, 'singbox', 'runtime.json'), '{}')

    // Flat files only: the sing-box subtree is regenerated on demand.
    assert.equal(await migrateDataDir(log, { home: dir }), 2)
    assert.equal(await readFile(join(dir, `.${CURRENT_NAME}`, 'adapter-status.json'), 'utf8'), '{"status":"ready"}')
    assert.equal(await readFile(join(dir, `.${CURRENT_NAME}`, 'agent-token.txt'), 'utf8'), 'tok\n')
    // The old directory still exists, so a downgrade keeps working.
    assert.equal(await readFile(join(from, 'adapter-status.json'), 'utf8'), '{"status":"ready"}')

    // Idempotent: a second run sees the new directory and does nothing.
    assert.equal(await migrateDataDir(log, { home: dir }), 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('migrateDataDir is a no-op when the user never ran the old plugin', async () => {
  const dir = await home()
  try {
    assert.equal(await migrateDataDir(logger(), { home: dir }), 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('missingKeys keeps the user\'s new-name values and fills only the gaps', () => {
  const diff = missingKeys(
    { ipPool: { enabled: true, manual: ['http://a:1'], pinnedExitId: 'x', free: { targetSize: 9, enabled: true } } },
    { ipPool: { enabled: false, free: { enabled: false } } },
  )
  // `enabled` already exists under the new name, so it is NOT copied over; the
  // missing siblings are. This is the "the user's new value wins" rule.
  assert.deepEqual(diff, {
    ipPool: { manual: ['http://a:1'], pinnedExitId: 'x', free: { targetSize: 9 } },
  })
  // Nothing missing -> undefined (the caller writes nothing).
  assert.equal(missingKeys({ a: 1 }, { a: 1 }), undefined)
  // A non-object legacy section carries no settings.
  assert.equal(missingKeys(undefined, {}), undefined)
  assert.equal(missingKeys([], {}), undefined)
})

test('mergeDeep never drops a sibling the user already had', () => {
  assert.deepEqual(
    mergeDeep({ ipPool: { enabled: false, free: { enabled: false } }, other: 1 }, { ipPool: { enabled: true, free: { targetSize: 9 } } }),
    { ipPool: { enabled: true, free: { enabled: false, targetSize: 9 } }, other: 1 },
  )
})

test('migrateSettingsDocument copies the saved ipPool section to the new key', async () => {
  const saved = { ipPool: { enabled: true, manual: ['http://1.2.3.4:8080'], probeModels: ['big-pickle'] } }
  const text = stringifyYaml({ [LEGACY_NAME]: saved, 'llm-pi-ai': { providers: {} } })
  const dir = await home(text)
  try {
    const copied = await migrateSettingsDocument(logger(), { home: dir })
    assert.equal(copied, 3, 'one per missing leaf')

    const doc = parseYaml(await readFile(settingsDocumentPath(dir), 'utf8')) as Record<string, any>
    assert.deepEqual(doc[CURRENT_NAME], saved)
    // The source section is untouched and unrelated namespaces survive.
    assert.deepEqual(doc[LEGACY_NAME], saved)
    assert.deepEqual(doc['llm-pi-ai'], { providers: {} })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('migrateSettingsDocument never overwrites a value already set under the new name', async () => {
  const doc = {
    [LEGACY_NAME]: { ipPool: { enabled: true, probeModels: ['old'] } },
    [CURRENT_NAME]: { ipPool: { enabled: false } },
  }
  const dir = await home(JSON.stringify(doc, null, 2))
  try {
    assert.equal(await migrateSettingsDocument(logger(), { home: dir }), 1)
    const next = parseYaml(await readFile(settingsDocumentPath(dir), 'utf8')) as Record<string, any>
    assert.deepEqual(next[CURRENT_NAME], { ipPool: { enabled: false, probeModels: ['old'] } })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('migrateSettingsDocument is idempotent and leaves a complete document byte-identical', async () => {
  const text = `\
${LEGACY_NAME}:
  ipPool:
    enabled: true
${CURRENT_NAME}:
  ipPool:
    enabled: true
`
  const dir = await home(text)
  try {
    assert.equal(await migrateSettingsDocument(logger(), { home: dir }), 0)
    assert.equal(await readFile(settingsDocumentPath(dir), 'utf8'), text, 'nothing to do means no rewrite')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('migrateSettingsDocument skips absent, empty and malformed documents without throwing', async () => {
  const log = logger()

  // No settings document at all (a headless or fresh install).
  const bare = await home()
  try { assert.equal(await migrateSettingsDocument(log, { home: bare }), 0) } finally { await rm(bare, { recursive: true, force: true }) }

  // Document with no retired section.
  const none = await home('llm-pi-ai:\n  providers: {}\n')
  try { assert.equal(await migrateSettingsDocument(log, { home: none }), 0) } finally { await rm(none, { recursive: true, force: true }) }

  // Unparseable YAML: logged, not thrown, and the file is left alone.
  const broken = await home(':\n\t- not: [valid\n')
  try {
    const before = await readFile(settingsDocumentPath(broken), 'utf8')
    assert.equal(await migrateSettingsDocument(log, { home: broken }), 0)
    assert.equal(await readFile(settingsDocumentPath(broken), 'utf8'), before)
  } finally { await rm(broken, { recursive: true, force: true }) }

  // A retired section that is not an object carries nothing to copy.
  const scalar = await home(`${LEGACY_NAME}: nope\n`)
  try { assert.equal(await migrateSettingsDocument(log, { home: scalar }), 0) } finally { await rm(scalar, { recursive: true, force: true }) }

  assert.ok(log.lines.some(([, ok]) => !ok), 'the YAML failure is logged as a warning')
})

test('runIdentityMigration does both halves and records the marker', async () => {
  const dir = await home(JSON.stringify({ [LEGACY_NAME]: { ipPool: { enabled: true } } }))
  try {
    await mkdir(join(dir, `.${LEGACY_NAME}`), { recursive: true })
    await writeFile(join(dir, `.${LEGACY_NAME}`, 'agent-token.txt'), 'tok\n')

    await runIdentityMigration({ home: dir }, logger())

    assert.equal(await readFile(join(dir, `.${CURRENT_NAME}`, 'agent-token.txt'), 'utf8'), 'tok\n')
    const doc = parseYaml(await readFile(settingsDocumentPath(dir), 'utf8')) as Record<string, any>
    assert.deepEqual(doc[CURRENT_NAME], { ipPool: { enabled: true } })
    const marker = JSON.parse(await readFile(join(dir, `.${CURRENT_NAME}`, 'migrated-from.json'), 'utf8'))
    assert.equal(marker.from, LEGACY_NAME)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
