#!/usr/bin/env node
// Read public directories without client disguise or session credentials.
//
// Assertions are STRUCTURAL on purpose. The upstream free roster rotates
// constantly (space-bunny-free, one of the ids this script used to pin, left
// the catalog and made the smoke fail while nothing was wrong), so a hardcoded
// model id here is a test that turns red on someone else's release schedule.
import assert from 'node:assert/strict'
import { ModelCatalog, staticFreeModels, FREE_LANE_BLOCKLIST } from '../packages/plugin/src/adapter/catalog.ts'

const catalog = new ModelCatalog({ fetchImpl: (url) => fetch(url, {
  headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30000),
}) })
try {
  await catalog.refreshOnce()
  assert.equal(catalog.snapshot().status, 'ready', `catalog did not become ready: ${JSON.stringify(catalog.snapshot())}`)
  assert.equal(catalog.lastError, '')
  const models = catalog.list()
  // The live roster must be non-empty and must not leak the blocklist. Which
  // specific ids it carries is upstream's business.
  assert.ok(models.length > 0, 'live catalog exposed no models')
  assert.ok(!models.some((id) => FREE_LANE_BLOCKLIST.has(id)), 'a blocklisted model was exposed')
  assert.ok(
    models.some((id) => id.toLowerCase().includes('free')),
    'no free-named model in the exposed roster',
  )
  // The bootstrap list is a fallback, not a promise: report which entries the
  // live catalog no longer carries instead of failing on them.
  const retired = staticFreeModels.filter((id) => !models.includes(id))
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), snapshot: catalog.snapshot(), models,
    retiredBootstrapModels: retired,
    transport: 'unauthenticated public directory GETs only; no inference requests' }, null, 2))
} finally { catalog.stop() }
