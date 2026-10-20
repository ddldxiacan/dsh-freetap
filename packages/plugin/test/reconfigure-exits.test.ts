/**
 * Regression: the settings page's manual/pin edits must reach the live pool.
 *
 * `reconfigure()` hot-applied every knob except the exit table itself — the
 * pool was built once at `startIpPool` and never reconciled, so adding a
 * manual proxy, removing one, pinning a line, or clearing the pin all saved
 * "successfully" and changed nothing (the pinned id could only ever be cleared
 * by removing the node).
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { ExitPool } from '../src/pool/pool.ts'
import { buildPoolFromConfig, parseManualProxy, syncManualExits } from '../src/ip-pool.ts'

test('parseManualProxy rejects unanchored/garbage rows and out-of-range ports', () => {
  // The validator was `/^\[[^\]]+\]|[^:]+:\d{1,5}$/`, where `|` splits the
  // pattern: the bracketed-IPv6 branch had no end anchor and no port, and the
  // port branch accepted 0 and 99999. Each parsed row is seeded into the pool
  // already `ok` with latency 0, so a typo outranked real exits.
  for (const entry of ['[abc]', '[2001:db8::1]', 'http://[::1]junk', '1.2.3.4:99999', '1.2.3.4:0', 'garbage', 'http://']) {
    assert.equal(parseManualProxy(entry), null, `should reject ${entry}`)
  }
  for (const entry of ['1.2.3.4:8080', 'http://[::1]:8080', 'socks5://1.2.3.4:1080']) {
    assert.ok(parseManualProxy(entry), `should accept ${entry}`)
  }
})

test('syncManualExits adds, removes and pins rows to match the saved settings', () => {
  const pool = buildPoolFromConfig({ ipPool: { manual: ['1.1.1.1:8080'] } })
  assert.deepEqual(pool.list().map((node) => node.id), ['1.1.1.1:8080'])

  // Add one and pin it.
  syncManualExits(pool, { manual: ['1.1.1.1:8080', '2.2.2.2:9090'], pinnedExitId: '2.2.2.2:9090' })
  assert.deepEqual(pool.list().map((node) => node.id).sort(), ['1.1.1.1:8080', '2.2.2.2:9090'])
  assert.equal(pool.pinnedId, '2.2.2.2:9090')
  assert.equal(pool.get('2.2.2.2:9090')?.pinned, true)

  // Clearing the pin must actually unpin (it used to be impossible).
  syncManualExits(pool, { manual: ['1.1.1.1:8080', '2.2.2.2:9090'], pinnedExitId: '' })
  assert.equal(pool.pinnedId, '')
  assert.equal(pool.get('2.2.2.2:9090')?.pinned, false)

  // Removing a row drops it.
  syncManualExits(pool, { manual: ['1.1.1.1:8080'] })
  assert.deepEqual(pool.list().map((node) => node.id), ['1.1.1.1:8080'])
})

test('syncManualExits never touches free or subscription rows', () => {
  const pool = new ExitPool()
  pool.add({ id: 'free:1', protocol: 'http', source: 'free', pinned: false, exitIP: '9.9.9.9', exitLocation: 'US', latencyMs: 100, quality: 'A', addedAt: 0 })
  pool.add({ id: 'sub:1', protocol: 'http', source: 'subscription', pinned: false, exitIP: '8.8.8.8', exitLocation: 'JP', latencyMs: 200, quality: 'A', addedAt: 0 })
  syncManualExits(pool, { manual: ['1.1.1.1:8080'] })
  assert.ok(pool.has('free:1'))
  assert.ok(pool.has('sub:1'))
  assert.ok(pool.has('1.1.1.1:8080'))
})

test('syncManualExits keeps measured health for a surviving row', () => {
  // A save must not throw away probe results for rows the user did not change.
  const pool = buildPoolFromConfig({ ipPool: { manual: ['1.1.1.1:8080'] } })
  const existing = pool.get('1.1.1.1:8080')!
  pool.add({ ...existing, exitIP: '5.5.5.5', exitLocation: 'SG', latencyMs: 120, quality: 'S' })
  syncManualExits(pool, { manual: ['1.1.1.1:8080', '3.3.3.3:7070'] })
  const kept = pool.get('1.1.1.1:8080')!
  assert.equal(kept.exitIP, '5.5.5.5')
  assert.equal(kept.latencyMs, 120)
  assert.equal(kept.quality, 'S')
})

test('the pin box alone seeds a routable exit', () => {
  const pool = buildPoolFromConfig({ ipPool: { pinnedExitId: '4.4.4.4:4444' } })
  assert.ok(pool.has('4.4.4.4:4444'))
  assert.equal(pool.pinnedId, '4.4.4.4:4444')
})

test('a failed trusted admission is reported degraded and sorts last', async () => {
  // admitTrusted keeps the node on purpose, but it must not claim health:
  // latency 0 grades 'S' and wins pick()'s ascending-latency sort, and callers
  // used to call markOk() on the same verdict.
  const { admitTrusted } = await import('../src/pool/admission.ts')
  const pool = new ExitPool()
  const verdict = await admitTrusted({
    pool,
    undici: {
      ProxyAgent: class { constructor() { throw new Error('connect ECONNREFUSED') } },
      request: async () => { throw new Error('connect ECONNREFUSED') },
    } as never,
    logger: { warn: () => {} },
  }, { address: 'dead:1', protocol: 'http', source: 'manual' })
  assert.equal(verdict.admitted, true)
  assert.equal(verdict.degraded, true)
  assert.ok((verdict.node?.latencyMs ?? 0) > 0, 'unmeasured latency must not be 0')
  assert.equal(verdict.node?.quality, 'C')
})
