import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MaintenanceMode } from '../src/app/maintenanceMode.js'

test('persists pause details and allows an administrator to resume', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'astra-bot-state-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const filePath = join(directory, 'bot-state.json')
  const now = new Date('2026-08-05T12:00:00.000Z')
  const mode = await MaintenanceMode.open(filePath, () => now)

  const paused = await mode.pause({
    pausedBy: '123456',
    reason: 'Updating the Wiki',
    durationMinutes: 15,
  })

  assert.equal(paused.paused, true)
  assert.equal(paused.pausedBy, '123456')
  assert.equal(paused.reason, 'Updating the Wiki')
  assert.equal(paused.resumeAt?.toISOString(), '2026-08-05T12:15:00.000Z')

  const reloaded = await MaintenanceMode.open(filePath, () => now)
  assert.equal((await reloaded.status()).paused, true)
  assert.equal(await reloaded.resume(), true)
  assert.equal((await reloaded.status()).paused, false)

  const persisted = JSON.parse(await readFile(filePath, 'utf8')) as { maintenance: unknown }
  assert.equal(persisted.maintenance, null)
})

test('automatically resumes an expired pause after a restart', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'astra-bot-state-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const filePath = join(directory, 'bot-state.json')
  let now = new Date('2026-08-05T12:00:00.000Z')
  const mode = await MaintenanceMode.open(filePath, () => now)
  await mode.pause({ pausedBy: '123456', durationMinutes: 5 })

  now = new Date('2026-08-05T12:06:00.000Z')
  const reloaded = await MaintenanceMode.open(filePath, () => now)

  assert.equal((await reloaded.status()).paused, false)
  assert.equal(await reloaded.resume(), false)
})

test('rejects an invalid automatic-resume duration without pausing', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'astra-bot-state-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const mode = await MaintenanceMode.open(join(directory, 'bot-state.json'))

  await assert.rejects(
    mode.pause({ pausedBy: '123456', durationMinutes: 0 }),
    /positive number of minutes/,
  )
  assert.equal((await mode.status()).paused, false)
})
