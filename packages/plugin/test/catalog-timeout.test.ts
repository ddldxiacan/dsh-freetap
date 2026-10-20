/**
 * Regression: the catalog refresh must be BOUNDED.
 *
 * `withTimeout()` built an AbortController and never passed its signal to
 * fetch, so it timed out nothing: a peer that accepted the connection and
 * stalled held the refresh round open indefinitely (a stalling local server
 * left the round pending past 40s against a 30s window). The deadline now
 * travels through `signal` and covers the body read too.
 *
 * Also pins the per-source error folding: one shared `lastError` written by
 * both concurrent halves reported whichever source finished LAST, so a healthy
 * Zen refresh erased a models.dev failure and vice versa.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { ModelCatalog } from '../src/adapter/catalog.ts'

test('a stalling peer cannot hang the refresh round', async () => {
  const server = createServer(() => { /* accept, never answer */ })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as { port: number }
  const catalog = new ModelCatalog({
    zenBaseUrl: `http://127.0.0.1:${port}/zen`,
    metadataUrl: `http://127.0.0.1:${port}/api.json`,
  })
  const startedAt = Date.now()
  try {
    // The real window is 30s; assert that the round SETTLES at all rather than
    // polling for a shorter timeout (the bug was an unbounded wait).
    await Promise.race([
      catalog.refreshOnce(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('refresh round never settled')), 45_000)),
    ])
    assert.ok(Date.now() - startedAt < 45_000)
    assert.match(catalog.lastError, /timed out/i)
    assert.equal(catalog.snapshot().status, 'error')
  } finally {
    catalog.stop()
    server.closeAllConnections()
    await new Promise((done) => server.close(done))
  }
})

test('an error from one source is not erased by the other source finishing later', async () => {
  // metadata fails fast, zen succeeds slowly: the old shared field ended ''
  const catalog = new ModelCatalog({
    fetchImpl: (async (url: string | URL) => {
      if (String(url).includes('/v1/models')) {
        await new Promise((resolve) => setTimeout(resolve, 60))
        return new Response(JSON.stringify({ data: [{ id: 'big-pickle' }] }), { status: 200 })
      }
      await new Promise((resolve) => setTimeout(resolve, 5))
      return new Response('boom', { status: 500 })
    }) as typeof fetch,
  })
  try {
    await catalog.refreshOnce()
    assert.match(catalog.lastError, /models\.dev returned HTTP 500/)
  } finally {
    catalog.stop()
  }
})
