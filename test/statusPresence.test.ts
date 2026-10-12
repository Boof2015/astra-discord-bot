import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import test from 'node:test'
import { ActivityType, Events, type Client, type PresenceData } from 'discord.js'
import { loadConfig } from '../src/config.js'
import { startStatusPresence } from '../src/discord/statusPresence.js'

test('Discord adapter sends custom text, tracks reconnects, and removes listeners on shutdown', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'wiki-presence-test-'))
  const path = join(directory, 'statuses.yml')
  await writeFile(path, JSON.stringify({
    pairChance: 0, solos: { astra: ['Somewhere in a test queue'], prism: [] }, pairs: [],
  }))
  const presences: PresenceData[] = []
  // discord.js can retain client-level readiness during a shard reconnect.
  const client = Object.assign(new EventEmitter(), {
    isReady: () => true,
    user: { setPresence: (presence: PresenceData) => { presences.push(presence) } },
  })
  const config = loadConfig({ requireDiscord: false })
  const stop = await startStatusPresence(client as unknown as Client, {
    ...config,
    identity: { ...config.identity, productName: 'Astra' },
    statusMessagesFile: path,
    statusSharedDirectory: directory,
  })
  context.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }) })
  assert.deepEqual(presences, [{
    activities: [{ name: 'Custom Status', type: ActivityType.Custom, state: 'Somewhere in a test queue' }],
  }])

  const heartbeatPath = join(directory, 'astra.json')
  const waitForOnline = async (online: boolean) => {
    const deadline = performance.now() + 3_000
    while (performance.now() < deadline) {
      const heartbeat = JSON.parse(await readFile(heartbeatPath, 'utf8')) as { online: boolean }
      if (heartbeat.online === online) return
      await setTimeout(10)
    }
    assert.fail(`Heartbeat did not become online=${online}`)
  }
  client.emit(Events.ShardReconnecting, 0)
  await waitForOnline(false)
  assert.equal(presences.length, 1)
  // A new session emits shardReady, whereas a resumed session emits shardResume.
  client.emit(Events.ShardReady, 0)
  await waitForOnline(true)
  client.emit(Events.ShardDisconnect, {}, 0)
  await waitForOnline(false)
  client.emit(Events.ShardResume, 0)
  await waitForOnline(true)
  await stop()
  assert.equal(client.eventNames().length, 0)
  await assert.rejects(readFile(heartbeatPath), { code: 'ENOENT' })
})
