import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { parseStatusCatalog, planStatus, type StatusCatalog } from '../src/app/statusCatalog.js'
import {
  FileHeartbeatStore, StatusRotation, STATUS_HEARTBEAT_TIMEOUT_MS,
  type HeartbeatStore,
} from '../src/app/statusRotation.js'

function catalog(overrides: Partial<StatusCatalog> = {}): StatusCatalog {
  return parseStatusCatalog({
    rotationMinutes: 10, pairChance: 1, seed: 'test-seed',
    solos: { astra: ['Astra solo one', 'Astra solo two'], prism: ['Prism solo one', 'Prism solo two'] },
    pairs: [
      { id: 'first', astra: 'Astra first half', prism: 'Prism first half' },
      { id: 'second', astra: 'Astra second half', prism: 'Prism second half' },
    ],
    ...overrides,
  })
}

const partnerMissing = {
  astra: ['Astra missing one', 'Astra missing two'],
  prism: ['Prism missing one', 'Prism missing two'],
}

const partnerReturned = {
  astra: [
    { id: 'astra-return-one', astra: 'Astra back one', prism: 'Prism welcomes Astra one' },
    { id: 'astra-return-two', astra: 'Astra back two', prism: 'Prism welcomes Astra two' },
  ],
  prism: [
    { id: 'prism-return-one', astra: 'Astra welcomes Prism one', prism: 'Prism back one' },
    { id: 'prism-return-two', astra: 'Astra welcomes Prism two', prism: 'Prism back two' },
  ],
}

async function setup(context: TestContext, messages = catalog(), prismMessages = messages) {
  const directory = await mkdtemp(join(tmpdir(), 'wiki-status-test-'))
  let now = Date.parse('2026-10-12T12:01:00Z')
  let astraOnline = true
  let prismOnline = true
  const astraTexts: Array<string | null> = []
  const prismTexts: Array<string | null> = []
  const warnings: string[] = []
  const astraStore = new FileHeartbeatStore(directory, 'astra')
  const prismStore = new FileHeartbeatStore(directory, 'prism')
  const astra = new StatusRotation(messages, 'astra', astraStore, {
    isReady: () => astraOnline,
    setStatus: (text) => { astraTexts.push(text) },
  }, () => now, (warning) => { warnings.push(warning) })
  const prism = new StatusRotation(prismMessages, 'prism', prismStore, {
    isReady: () => prismOnline,
    setStatus: (text) => { prismTexts.push(text) },
  }, () => now, (warning) => { warnings.push(warning) })
  context.after(async () => {
    await Promise.all([astra.stop(), prism.stop()])
    await rm(directory, { recursive: true, force: true })
  })
  return {
    directory, astra, prism, astraStore, prismStore, astraTexts, prismTexts, warnings,
    now: () => now,
    advance: (milliseconds: number) => { now += milliseconds },
    astraOnline: (online: boolean) => { astraOnline = online },
    prismOnline: (online: boolean) => { prismOnline = online },
    pair: () => planStatus(messages, 'astra', now).pair!,
  }
}

test('empty status lists are valid, but incomplete or oversized pairs are rejected', () => {
  assert.equal(catalog({ solos: { astra: [], prism: [] }, pairs: [] }).pairs.length, 0)
  assert.deepEqual(catalog().partnerMissing, { astra: [], prism: [] })
  assert.deepEqual(catalog().partnerReturned, { astra: [], prism: [] })
  assert.equal(catalog().reunionMinutes, 2)
  assert.throws(() => catalog({ partnerReturned: {
    astra: [{ id: 'bad', astra: 'Hello', prism: '' }], prism: [],
  } }), /partnerReturned.astra/)
  assert.throws(() => catalog({ partnerReturned: {
    astra: [], prism: [{ id: 'bad', astra: 'x'.repeat(129), prism: 'Hello' }],
  } }), /partnerReturned.prism/)
  assert.throws(() => catalog({ partnerReturned, solos: { astra: ['Solo'], prism: [] }, pairs: [] }), /Both bots need solo/)
  assert.throws(() => catalog({ partnerReturned: {
    astra: [partnerReturned.astra[0]!, partnerReturned.astra[0]!], prism: [],
  } }), /Duplicate/)
  for (const reunionMinutes of [0, 61, NaN, Infinity]) {
    assert.throws(() => catalog({ reunionMinutes }), /reunionMinutes/)
  }
  assert.throws(() => catalog({ partnerMissing: { astra: ['x'.repeat(129)], prism: [] } }), /partnerMissing.astra/)
  assert.throws(() => catalog({ partnerMissing: { astra: [], prism: ['two\nlines'] } }), /partnerMissing.prism/)
  assert.throws(() => catalog({ solos: { astra: [], prism: ['Solo'] } }), /Both bots need solo/)
  assert.throws(() => catalog({ pairs: [{ id: 'bad', astra: 'Hello', prism: '' }] }), /1-128/)
  assert.throws(() => catalog({ pairs: [{ id: 'bad', astra: 'x'.repeat(129), prism: 'Hello' }] }), /1-128/)
  assert.throws(() => catalog({ pairChance: 1.5 }), /pairChance/)
  assert.throws(() => catalog({ rotationMinutes: 0 }), /rotationMinutes/)
  const pair = { id: 'duplicate', astra: 'Hello', prism: 'Reply' }
  assert.throws(() => catalog({ pairs: [pair, pair] }), /Duplicate/)
})

test('both processes select the same pair across slots, independently of product and startup', () => {
  const messages = catalog({ pairChance: 0.15 })
  let paired = 0
  const selected = new Set<string>()
  for (let slot = 0; slot < 500; slot++) {
    const timestamp = slot * messages.rotationMinutes * 60_000 + 123
    const astra = planStatus(messages, 'astra', timestamp)
    const prism = planStatus(messages, 'prism', timestamp + 10_000)
    assert.equal(astra.pair?.id, prism.pair?.id)
    assert.equal(astra.slot, prism.slot)
    if (astra.pair) { paired++; selected.add(astra.pair.id) }
  }
  assert.ok(paired > 25 && paired < 125)
  assert.equal(selected.size, 2)
})

test('separate bots with a shared volume converge on a matching pair and avoid redundant updates', async (context) => {
  const state = await setup(context)
  await state.astra.tick()
  assert.ok(state.astraTexts.at(-1)?.startsWith('Astra solo'))
  await state.prism.tick()
  state.advance(10_000)
  await state.astra.tick()
  assert.equal(state.astraTexts.at(-1), state.pair().astra)
  assert.equal(state.prismTexts.at(-1), state.pair().prism)
  const updates = state.astraTexts.length
  state.advance(10_000)
  await Promise.all([state.astra.tick(), state.prism.tick()])
  assert.equal(state.astraTexts.length, updates)
  assert.deepEqual(state.warnings, [])
})

test('a Discord disconnection withdraws the heartbeat and the partner returns to a solo', async (context) => {
  const state = await setup(context)
  await state.astra.tick()
  await state.prism.tick()
  state.advance(10_000)
  await state.astra.tick()
  state.prismOnline(false)
  const sentBeforeDisconnect = state.prismTexts.length
  state.advance(10_000)
  await state.prism.tick()
  await state.astra.tick()
  assert.equal(state.prismTexts.length, sentBeforeDisconnect)
  assert.equal((await state.astraStore.peer())?.online, false)
  assert.ok(state.astraTexts.at(-1)?.startsWith('Astra solo'))
  state.prismOnline(true)
  state.advance(10_000)
  await state.prism.tick()
  await state.astra.tick()
  assert.equal(state.astraTexts.at(-1), state.pair().astra)
  assert.equal(state.prismTexts.at(-1), state.pair().prism)
})

test('a crashed partner expires, while a graceful shutdown removes its heartbeat immediately', async (context) => {
  const state = await setup(context)
  await state.astra.tick()
  await state.prism.tick()
  state.advance(10_000)
  await state.astra.tick()
  state.advance(STATUS_HEARTBEAT_TIMEOUT_MS + 1)
  await state.astra.tick()
  assert.ok(state.astraTexts.at(-1)?.startsWith('Astra solo'))
  state.advance(10_000)
  await state.prism.tick()
  await state.astra.tick()
  assert.equal(state.astraTexts.at(-1), state.pair().astra)
  await state.prism.stop()
  assert.equal(await state.astraStore.peer(), null)
  state.advance(10_000)
  await state.astra.tick()
  assert.ok(state.astraTexts.at(-1)?.startsWith('Astra solo'))
  await state.prism.tick()
  assert.equal(await state.astraStore.peer(), null)
})

test('mismatched catalogs never pair, including changed text with the same pair IDs', async (context) => {
  const messages = catalog({ partnerMissing })
  const changed = catalog({ partnerMissing, pairs: messages.pairs.map(pair => ({ ...pair, prism: 'Different reply' })) })
  const state = await setup(context, messages, changed)
  await state.astra.tick()
  await state.prism.tick()
  state.advance(10_000)
  await state.astra.tick()
  assert.ok(state.astraTexts.at(-1)?.startsWith('Astra solo'))
  assert.ok(state.prismTexts.at(-1)?.startsWith('Prism solo'))
})

test('missing-partner lines require seeing a live partner in this process first', async (context) => {
  const state = await setup(context, catalog({ partnerMissing, pairChance: 0 }))
  await state.astra.tick()
  assert.ok(state.astraTexts.at(-1)?.startsWith('Astra solo'))
  await state.prism.tick()
  state.advance(STATUS_HEARTBEAT_TIMEOUT_MS + 1)
  await state.astra.tick()
  assert.ok(state.astraTexts.at(-1)?.startsWith('Astra solo'))

  await state.prism.tick()
  state.advance(10_000)
  await state.astra.tick()
  assert.ok(state.astraTexts.at(-1)?.startsWith('Astra solo'))
  await state.prism.stop()
  state.advance(10_000)
  await state.astra.tick()
  assert.ok(partnerMissing.astra.includes(state.astraTexts.at(-1)!))
})

test('a crashed partner activates rotating missing lines until it returns', async (context) => {
  const state = await setup(context, catalog({ partnerMissing }))
  await state.astra.tick()
  await state.prism.tick()
  state.advance(10_000)
  await state.astra.tick()
  assert.equal(state.astraTexts.at(-1), state.pair().astra)
  state.advance(STATUS_HEARTBEAT_TIMEOUT_MS + 1)
  await state.astra.tick()
  assert.ok(partnerMissing.astra.includes(state.astraTexts.at(-1)!))
  const updates = state.astraTexts.length
  await state.astra.tick()
  assert.equal(state.astraTexts.length, updates)
  for (let slot = 0; slot < 4; slot++) {
    state.advance(600_000)
    await state.astra.tick()
    assert.ok(partnerMissing.astra.includes(state.astraTexts.at(-1)!))
    assert.notEqual(state.astraTexts.at(-1), state.astraTexts.at(-2))
  }
  await state.prism.tick()
  state.advance(10_000)
  await state.astra.tick()
  assert.equal(state.astraTexts.at(-1), state.pair().astra)
  assert.equal(state.prismTexts.at(-1), state.pair().prism)
})

test('Prism uses its own missing lines when Astra disconnects during a solo slot', async (context) => {
  const state = await setup(context, catalog({ partnerMissing, pairChance: 0 }))
  await state.astra.tick()
  await state.prism.tick()
  state.astraOnline(false)
  state.advance(10_000)
  await state.astra.tick()
  await state.prism.tick()
  assert.ok(partnerMissing.prism.includes(state.prismTexts.at(-1)!))
  state.astraOnline(true)
  state.advance(10_000)
  await state.astra.tick()
  await state.prism.tick()
  assert.ok(state.prismTexts.at(-1)?.startsWith('Prism solo'))
})

test('shared-volume errors after seeing a partner do not activate disappearance lines', async (context) => {
  let now = 1_000_000
  let unavailable = false
  let peerOnline = true
  let peer: Awaited<ReturnType<HeartbeatStore['peer']>> = null
  const texts: Array<string | null> = []
  const store: HeartbeatStore = {
    publish: async (heartbeat) => { peer = { ...heartbeat, session: 'partner', online: peerOnline } },
    peer: async () => {
      if (unavailable) throw new Error('Shared volume unavailable')
      return peer
    },
    remove: async () => {},
  }
  const rotation = new StatusRotation(catalog({ partnerMissing, partnerReturned }), 'astra', store, {
    isReady: () => true, setStatus: text => { texts.push(text) },
  }, () => now, () => {})
  context.after(() => rotation.stop())
  await rotation.tick()
  assert.ok(texts.at(-1)?.endsWith('half'))
  unavailable = true
  now += 10_000
  await rotation.tick()
  assert.ok(texts.at(-1)?.startsWith('Astra solo'))
  unavailable = false
  now += 10_000
  await rotation.tick()
  assert.ok(texts.at(-1)?.endsWith('half'))
  peerOnline = false
  now += 10_000
  await rotation.tick()
  assert.ok(partnerMissing.astra.includes(texts.at(-1)!))
})

test('a Prism return shares one reunion across slot boundaries, then resumes normal pairs', async (context) => {
  const state = await setup(context, catalog({ partnerMissing, partnerReturned, rotationMinutes: 1 }))
  await state.astra.tick()
  await state.prism.tick()
  state.advance(10_000)
  await state.astra.tick()
  assert.equal(state.astraTexts.at(-1), state.pair().astra)
  assert.equal(state.prismTexts.at(-1), state.pair().prism)

  state.prismOnline(false)
  state.advance(10_000)
  await state.prism.tick()
  await state.astra.tick()
  assert.ok(partnerMissing.astra.includes(state.astraTexts.at(-1)!))
  state.prismOnline(true)
  state.advance(10_000)
  await state.prism.tick()
  await state.astra.tick()
  const greeting = state.astraTexts.at(-1)!
  const pair = partnerReturned.prism.find(pair => pair.astra === greeting)
  assert.ok(pair)
  assert.equal((await state.prismStore.peer())?.pairId, null)

  for (let step = 1; step < 12; step++) {
    state.advance(10_000)
    await state.prism.tick()
    await state.astra.tick()
    assert.equal(state.astraTexts.at(-1), greeting)
    assert.equal(state.prismTexts.at(-1), pair.prism)
    assert.deepEqual((await state.astraStore.peer())?.reunion, (await state.prismStore.peer())?.reunion)
  }
  state.advance(10_000)
  await state.prism.tick()
  await state.astra.tick()
  assert.equal(state.astraTexts.at(-1), state.pair().astra)
  for (let step = 0; step < 2; step++) {
    state.advance(10_000)
    await state.prism.tick()
    await state.astra.tick()
    assert.equal(state.astraTexts.at(-1), state.pair().astra)
    assert.equal(state.prismTexts.at(-1), state.pair().prism)
  }
  assert.equal(state.astraTexts.filter(text => text === greeting).length, 1)
})

test('another disappearance cancels a reunion and the next return selects a different greeting', async (context) => {
  const state = await setup(context, catalog({ partnerMissing, partnerReturned, pairChance: 0 }))
  await state.astra.tick()
  await state.prism.tick()
  let previous: string | null = null
  for (let visit = 0; visit < 2; visit++) {
    state.astraOnline(false)
    state.advance(10_000)
    await state.astra.tick()
    await state.prism.tick()
    assert.ok(partnerMissing.prism.includes(state.prismTexts.at(-1)!))
    state.astraOnline(true)
    state.advance(10_000)
    await state.astra.tick()
    await state.prism.tick()
    const greeting = state.prismTexts.at(-1)!
    const pair = partnerReturned.astra.find(pair => pair.prism === greeting)
    assert.ok(pair)
    assert.notEqual(greeting, previous)
    state.advance(10_000)
    await state.astra.tick()
    await state.prism.tick()
    assert.equal(state.astraTexts.at(-1), pair.astra)
    assert.equal(state.prismTexts.at(-1), pair.prism)
    previous = greeting
  }
})

test('return greetings also work after a crash with no missing lines configured', async (context) => {
  const state = await setup(context, catalog({ partnerReturned, pairChance: 0 }))
  await state.astra.tick()
  await state.prism.tick()
  state.advance(10_000)
  await state.astra.tick()
  state.advance(STATUS_HEARTBEAT_TIMEOUT_MS + 1)
  await state.astra.tick()
  assert.ok(state.astraTexts.at(-1)?.startsWith('Astra solo'))
  await state.prism.tick()
  state.advance(10_000)
  await state.astra.tick()
  const pair = partnerReturned.prism.find(pair => pair.astra === state.astraTexts.at(-1))
  assert.ok(pair)
  state.advance(10_000)
  await state.prism.tick()
  assert.equal(state.prismTexts.at(-1), pair.prism)
})

test('a bot does not mistake its own offline observations for a partner disappearance', async (context) => {
  const state = await setup(context, catalog({ partnerReturned }))
  await state.astra.tick()
  await state.prism.tick()
  state.advance(10_000)
  await state.astra.tick()
  state.astraOnline(false)
  state.advance(STATUS_HEARTBEAT_TIMEOUT_MS + 1)
  await state.astra.tick()
  await state.prism.tick()
  state.astraOnline(true)
  state.advance(10_000)
  await state.astra.tick()
  assert.equal(state.astraTexts.at(-1), state.pair().astra)
})

test('a restart joins the current pair instead of resetting the shared schedule', async (context) => {
  const messages = catalog({ partnerReturned })
  const state = await setup(context, messages)
  await state.astra.tick()
  await state.prism.tick()
  await state.astra.stop()
  const texts: Array<string | null> = []
  const restarted = new StatusRotation(messages, 'astra', state.astraStore, {
    isReady: () => true, setStatus: text => { texts.push(text) },
  }, state.now)
  context.after(() => restarted.stop())
  await restarted.tick()
  assert.equal(texts.at(-1), state.pair().astra)
})

for (const returning of ['astra', 'prism'] as const) {
  test(`a full ${returning} restart joins the matching directional reunion`, async (context) => {
    const messages = catalog({ partnerMissing, partnerReturned, pairChance: 0 })
    const state = await setup(context, messages)
    const staying = returning === 'astra' ? 'prism' : 'astra'
    await state.astra.tick()
    await state.prism.tick()
    state.advance(10_000)
    await state.astra.tick()
    await state[returning].stop()
    state.advance(10_000)
    await state[staying].tick()
    assert.ok(partnerMissing[staying].includes(state[`${staying}Texts`].at(-1)!))

    const returnedTexts: Array<string | null> = []
    const restarted = new StatusRotation(messages, returning, state[`${returning}Store`], {
      isReady: () => true, setStatus: text => { returnedTexts.push(text) },
    }, state.now)
    context.after(() => restarted.stop())
    state.advance(10_000)
    await restarted.tick()
    await state[staying].tick()
    const pair = partnerReturned[returning].find(pair => pair[staying] === state[`${staying}Texts`].at(-1))
    assert.ok(pair)
    state.advance(10_000)
    await restarted.tick()
    await state[staying].tick()
    assert.equal(returnedTexts.at(-1), pair[returning])
    assert.equal(state[`${staying}Texts`].at(-1), pair[staying])
    const astraEvent = (await state.prismStore.peer())?.reunion
    const prismEvent = (await state.astraStore.peer())?.reunion
    assert.deepEqual(astraEvent, prismEvent)
    assert.equal(astraEvent?.returning, returning)
  })
}

test('reunion announcements reject old sessions, invalid times, unknown rows, and catalog mismatches', async (context) => {
  const messages = catalog({ partnerReturned, pairChance: 0 })
  const state = await setup(context, messages)
  await state.astra.tick()
  await state.prism.tick()
  const own = await state.prismStore.peer()
  const peer = await state.astraStore.peer()
  assert.ok(own && peer)
  const duration = messages.reunionMinutes * 60_000
  const event = {
    id: 'reunion-test', returning: 'prism' as const, pairId: partnerReturned.prism[0]!.id,
    astraSession: own.session, prismSession: peer.session,
    startedAt: state.now(), expiresAt: state.now() + duration,
  }
  for (const invalid of [
    { ...event, astraSession: 'previous-process' },
    { ...event, prismSession: 'previous-process' },
    { ...event, startedAt: state.now() - duration, expiresAt: state.now() },
    { ...event, startedAt: state.now() + duration, expiresAt: state.now() + 2 * duration },
    { ...event, expiresAt: state.now() + 2 * duration },
    { ...event, pairId: 'unknown-row' },
    { ...event, returning: 'astra' as const },
  ]) {
    state.advance(10_000)
    await state.prismStore.publish({ ...peer, updatedAt: state.now(), reunion: invalid })
    await state.astra.tick()
    assert.ok(state.astraTexts.at(-1)?.startsWith('Astra solo'))
    assert.equal((await state.prismStore.peer())?.reunion, null)
  }
  state.advance(10_000)
  await state.prismStore.publish({ ...peer, updatedAt: state.now(), fingerprint: 'different', reunion: event })
  await state.astra.tick()
  assert.ok(state.astraTexts.at(-1)?.startsWith('Astra solo'))
})

test('overlapping returns converge on one reunion without extending its expiry', async (context) => {
  const state = await setup(context, catalog({ partnerMissing, partnerReturned, pairChance: 0 }))
  await state.astra.tick()
  await state.prism.tick()
  state.prismOnline(false)
  state.advance(10_000)
  await state.prism.tick()
  await state.astra.tick()
  state.astraOnline(false)
  state.prismOnline(true)
  state.advance(10_000)
  await state.astra.tick()
  await state.prism.tick()
  state.astraOnline(true)
  state.advance(10_000)
  await state.astra.tick()
  await state.prism.tick()
  for (let tick = 0; tick < 2; tick++) {
    state.advance(10_000)
    await state.astra.tick()
    await state.prism.tick()
  }
  const event = (await state.prismStore.peer())?.reunion
  assert.ok(event)
  assert.deepEqual(event, (await state.astraStore.peer())?.reunion)
  const pair = partnerReturned[event.returning].find(pair => pair.id === event.pairId)
  assert.ok(pair)
  assert.equal(state.astraTexts.at(-1), pair.astra)
  assert.equal(state.prismTexts.at(-1), pair.prism)
  const expiresAt = event.expiresAt
  state.advance(10_000)
  await state.astra.tick()
  await state.prism.tick()
  assert.equal((await state.prismStore.peer())?.reunion?.expiresAt, expiresAt)
  assert.equal((await state.astraStore.peer())?.reunion?.expiresAt, expiresAt)
})

test('old-slot, corrupt, and future-dated heartbeats cannot start a pair', async (context) => {
  const state = await setup(context)
  await state.prism.tick()
  const path = join(state.directory, 'prism.json')
  const peer = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  for (const invalid of [
    { ...peer, slot: -1 },
    { ...peer, updatedAt: state.now() + 86_400_000 },
    { ...peer, online: 'true' },
  ]) {
    await writeFile(path, JSON.stringify(invalid))
    await state.astra.tick()
    assert.ok(state.astraTexts.at(-1)?.startsWith('Astra solo'))
    state.advance(10_000)
  }
  await writeFile(path, '{invalid json')
  await state.astra.tick()
  assert.ok(state.astraTexts.at(-1)?.startsWith('Astra solo'))
})

test('solo rotation avoids immediate repeats and reconnects are rate limited', async (context) => {
  const state = await setup(context, catalog({ pairChance: 0 }))
  for (let slot = 0; slot < 12; slot++) {
    await state.astra.tick()
    if (slot > 0) assert.notEqual(state.astraTexts.at(-1), state.astraTexts.at(-2))
    state.advance(600_000)
  }
  await state.astra.tick()
  const updates = state.astraTexts.length
  for (let attempt = 0; attempt < 10; attempt++) {
    state.astra.reconnect()
    await state.astra.tick()
  }
  assert.equal(state.astraTexts.length, updates)
  state.advance(10_000)
  await state.astra.tick()
  assert.equal(state.astraTexts.length, updates + 1)
})

test('shared-volume failures preserve solo statuses and do not flood warnings', async () => {
  let now = 1_000_000
  const texts: Array<string | null> = []
  const warnings: string[] = []
  const store: HeartbeatStore = {
    publish: async () => { throw new Error('Shared volume unavailable') },
    peer: async () => null,
    remove: async () => {},
  }
  const rotation = new StatusRotation(catalog(), 'astra', store, {
    isReady: () => true, setStatus: text => { texts.push(text) },
  }, () => now, message => { warnings.push(message) })
  await rotation.tick()
  now += 10_000
  await rotation.tick()
  assert.ok(texts.at(-1)?.startsWith('Astra solo'))
  assert.equal(warnings.length, 1)
  await rotation.stop()
})
