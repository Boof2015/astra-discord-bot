import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  planStatus, selectReunionPair, statusCatalogFingerprint,
  type StatusCatalog, type StatusProduct,
} from './statusCatalog.js'

export const STATUS_HEARTBEAT_INTERVAL_MS = 10_000
export const STATUS_HEARTBEAT_TIMEOUT_MS = 35_000
const MINIMUM_PRESENCE_INTERVAL_MS = 5_000

export interface StatusReunion {
  id: string
  returning: StatusProduct
  pairId: string
  startedAt: number
  expiresAt: number
  astraSession: string
  prismSession: string
}

export interface StatusHeartbeat {
  version: 1
  session: string
  updatedAt: number
  online: boolean
  fingerprint: string
  slot: number
  pairId: string | null
  reunion?: StatusReunion | null
}

export interface HeartbeatStore {
  publish(heartbeat: StatusHeartbeat): Promise<void>
  peer(): Promise<StatusHeartbeat | null>
  remove(session: string): Promise<void>
}

function validReunion(value: unknown): value is StatusReunion {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<StatusReunion>
  return typeof entry.id === 'string' && entry.id.length > 0
    && (entry.returning === 'astra' || entry.returning === 'prism')
    && typeof entry.pairId === 'string'
    && typeof entry.startedAt === 'number' && Number.isSafeInteger(entry.startedAt)
    && typeof entry.expiresAt === 'number' && Number.isSafeInteger(entry.expiresAt)
    && typeof entry.astraSession === 'string' && typeof entry.prismSession === 'string'
}

function validHeartbeat(value: unknown): value is StatusHeartbeat {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<StatusHeartbeat>
  return entry.version === 1
    && typeof entry.session === 'string'
    && typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)
    && typeof entry.online === 'boolean'
    && typeof entry.fingerprint === 'string'
    && typeof entry.slot === 'number' && Number.isSafeInteger(entry.slot)
    && (entry.pairId === null || typeof entry.pairId === 'string')
    && (entry.reunion == null || validReunion(entry.reunion))
}

export class FileHeartbeatStore implements HeartbeatStore {
  readonly #ownPath: string
  readonly #peerPath: string

  constructor(private readonly directory: string, product: StatusProduct) {
    this.#ownPath = join(directory, `${product}.json`)
    this.#peerPath = join(directory, `${product === 'astra' ? 'prism' : 'astra'}.json`)
  }

  async publish(heartbeat: StatusHeartbeat): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    const temporaryPath = `${this.#ownPath}.${heartbeat.session}.tmp`
    try {
      await writeFile(temporaryPath, `${JSON.stringify(heartbeat)}\n`, 'utf8')
      await rename(temporaryPath, this.#ownPath)
    } finally {
      await rm(temporaryPath, { force: true })
    }
  }

  async #read(path: string): Promise<StatusHeartbeat | null> {
    try {
      const value: unknown = JSON.parse(await readFile(path, 'utf8'))
      return validHeartbeat(value) ? value : null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null
      throw error
    }
  }

  peer(): Promise<StatusHeartbeat | null> {
    return this.#read(this.#peerPath)
  }

  async remove(session: string): Promise<void> {
    if ((await this.#read(this.#ownPath))?.session === session) {
      await rm(this.#ownPath, { force: true })
    }
  }
}

export interface StatusConnection {
  isReady(): boolean
  setStatus(text: string | null): void
}

export class StatusRotation {
  readonly #session = randomUUID()
  readonly #fingerprint: string
  #timer: NodeJS.Timeout | null = null
  #running: Promise<void> | null = null
  #stopped = false
  #lastText: string | null | undefined
  #lastUpdate = -Infinity
  #soloSlot: number | null = null
  #solo: string | null = null
  #missing: string | null = null
  #hasSeenPartner = false
  #partnerWasMissing = false
  #reunion: StatusReunion | null = null
  #reunionNotBefore = -Infinity
  #lastReunionPairs: Partial<Record<StatusProduct, string>> = {}
  #lastError: string | null = null

  constructor(
    private readonly catalog: StatusCatalog,
    private readonly product: StatusProduct,
    private readonly store: HeartbeatStore,
    private readonly connection: StatusConnection,
    private readonly now: () => number = Date.now,
    private readonly warn: (message: string) => void = console.warn,
  ) {
    this.#fingerprint = statusCatalogFingerprint(catalog)
  }

  async start(): Promise<void> {
    if (this.#timer || this.#stopped) return
    this.#timer = setInterval(() => { void this.tick() }, STATUS_HEARTBEAT_INTERVAL_MS)
    this.#timer.unref()
    await this.tick()
  }

  reconnect(): void {
    this.#lastText = undefined
    void this.tick()
  }

  tick(): Promise<void> {
    if (this.#stopped) return Promise.resolve()
    if (!this.#running) {
      this.#running = this.#tick().catch((error: unknown) => {
        this.#report(error)
      }).finally(() => { this.#running = null })
    }
    return this.#running
  }

  #report(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    if (message !== this.#lastError) this.warn(`Status rotation (${this.product}): ${message}`)
    this.#lastError = message
  }

  #usableReunion(event: StatusReunion | null | undefined, peer: StatusHeartbeat, now: number): event is StatusReunion {
    if (!event || peer.fingerprint !== this.#fingerprint) return false
    const astraSession = this.product === 'astra' ? this.#session : peer.session
    const prismSession = this.product === 'prism' ? this.#session : peer.session
    return event.astraSession === astraSession && event.prismSession === prismSession
      && event.startedAt > this.#reunionNotBefore && event.startedAt <= now && event.expiresAt > now
      && event.expiresAt - event.startedAt === this.catalog.reunionMinutes * 60_000
      && this.catalog.partnerReturned[event.returning].some(pair => pair.id === event.pairId)
  }

  #startReunion(peer: StatusHeartbeat, now: number): StatusReunion | null {
    const returning = this.product === 'astra' ? 'prism' : 'astra'
    const id = randomUUID()
    const pair = selectReunionPair(this.catalog, returning, id, this.#lastReunionPairs[returning])
    return pair ? {
      id, returning, pairId: pair.id, startedAt: now,
      expiresAt: now + this.catalog.reunionMinutes * 60_000,
      astraSession: this.product === 'astra' ? this.#session : peer.session,
      prismSession: this.product === 'prism' ? this.#session : peer.session,
    } : null
  }

  async #tick(): Promise<void> {
    const now = this.now()
    const plan = planStatus(this.catalog, this.product, now)
    const online = this.connection.isReady()
    if (!online) this.#reunionNotBefore = now
    if (!online || (this.#reunion && this.#reunion.expiresAt <= now)) this.#reunion = null
    if (this.#soloSlot !== plan.slot) {
      let solo = plan.solo
      if (solo === this.#solo && this.catalog.solos[this.product].length > 1) {
        solo = this.catalog.solos[this.product][(plan.soloIndex + 1) % this.catalog.solos[this.product].length] ?? solo
      }
      this.#solo = solo
      const missingLines = this.catalog.partnerMissing[this.product]
      let missing = plan.missing
      if (missing === this.#missing && missingLines.length > 1) {
        missing = missingLines[(plan.missingIndex + 1) % missingLines.length] ?? missing
      }
      this.#missing = missing
      this.#soloSlot = plan.slot
    }
    let partnerReady = false
    let partnerMissing = false
    let reunionText: string | null = null
    try {
      const heartbeat: StatusHeartbeat = {
        version: 1, session: this.#session, updatedAt: now, online,
        fingerprint: this.#fingerprint, slot: plan.slot,
        pairId: this.#reunion ? null : plan.pair?.id ?? null,
        reunion: this.#reunion,
      }
      await this.store.publish(heartbeat)
      const peer = await this.store.peer()
      const age = peer ? this.now() - peer.updatedAt : Infinity
      const partnerOnline = Boolean(peer?.online && age >= 0 && age <= STATUS_HEARTBEAT_TIMEOUT_MS)
      // A different catalog or time slot prevents pairing, but is not a disappearance.
      partnerMissing = this.#hasSeenPartner && (!peer || !peer.online || age > STATUS_HEARTBEAT_TIMEOUT_MS)
      if (online && partnerMissing) {
        this.#partnerWasMissing = true
        this.#reunionNotBefore = now
        this.#reunion = null
      } else if (online && partnerOnline && peer) {
        this.#hasSeenPartner = true
        if (this.#partnerWasMissing) {
          this.#reunion = peer.fingerprint === this.#fingerprint ? this.#startReunion(peer, now) : null
          this.#partnerWasMissing = false
        }
        // Both processes adopt the same event; a fixed ordering also resolves simultaneous proposals.
        const candidates = [this.#reunion, peer.reunion]
          .filter(event => this.#usableReunion(event, peer, now))
          .sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id))
        this.#reunion = candidates[0] ?? null
        if (this.#reunion) {
          this.#lastReunionPairs[this.#reunion.returning] = this.#reunion.pairId
          reunionText = this.catalog.partnerReturned[this.#reunion.returning]
            .find(pair => pair.id === this.#reunion!.pairId)?.[this.product] ?? null
        }
      }
      if (heartbeat.reunion?.id !== this.#reunion?.id) {
        // Publish the event before displaying either half, and withdraw the normal pair.
        heartbeat.reunion = this.#reunion
        heartbeat.pairId = this.#reunion ? null : plan.pair?.id ?? null
        await this.store.publish(heartbeat)
      }
      partnerReady = Boolean(partnerOnline && peer
        && peer.fingerprint === this.#fingerprint && peer.slot === plan.slot
        && plan.pair && peer.pairId === plan.pair.id)
      this.#lastError = null
    } catch (error) {
      partnerMissing = false
      reunionText = null
      this.#report(error)
      // Presence is cosmetic: a shared-volume problem must not stop wiki replies.
    }
    if (!online || !this.connection.isReady()) {
      this.#lastText = undefined
      return
    }
    let text = this.#solo
    if (partnerMissing) text = this.#missing ?? text
    else if (reunionText) text = reunionText
    else if (partnerReady && plan.pair) text = plan.pair[this.product]
    if (text === this.#lastText || now - this.#lastUpdate < MINIMUM_PRESENCE_INTERVAL_MS) return
    try {
      this.connection.setStatus(text)
      this.#lastText = text
      this.#lastUpdate = now
    } catch (error) {
      await this.store.remove(this.#session).catch(() => {})
      throw error
    }
  }

  async stop(): Promise<void> {
    this.#stopped = true
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = null
    await this.#running
    try {
      await this.store.remove(this.#session)
    } catch (error) {
      this.#report(error)
    }
  }
}
