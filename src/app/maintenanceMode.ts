import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

interface PersistedPause {
  pausedAt: string
  pausedBy: string
  reason: string | null
  resumeAt: string | null
}

interface PersistedBotState {
  version: 1
  maintenance: PersistedPause | null
}

export interface MaintenanceStatus {
  paused: boolean
  pausedAt: Date | null
  pausedBy: string | null
  reason: string | null
  resumeAt: Date | null
}

export interface PauseMaintenanceOptions {
  pausedBy: string
  reason?: string | null
  durationMinutes?: number | null
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function parsePause(value: unknown): PersistedPause | null {
  if (!value || typeof value !== 'object') return null
  if (!('pausedAt' in value) || !validDate(value.pausedAt)) return null
  if (!('pausedBy' in value) || typeof value.pausedBy !== 'string' || !value.pausedBy) return null
  if (!('reason' in value) || (value.reason !== null && typeof value.reason !== 'string')) return null
  if (!('resumeAt' in value) || (value.resumeAt !== null && !validDate(value.resumeAt))) return null
  return {
    pausedAt: value.pausedAt,
    pausedBy: value.pausedBy,
    reason: value.reason,
    resumeAt: value.resumeAt,
  }
}

async function readState(filePath: string): Promise<PersistedBotState> {
  try {
    const value: unknown = JSON.parse(await readFile(filePath, 'utf8'))
    if (
      value
      && typeof value === 'object'
      && 'version' in value
      && value.version === 1
      && 'maintenance' in value
    ) {
      if (value.maintenance === null) return { version: 1, maintenance: null }
      const maintenance = parsePause(value.maintenance)
      if (maintenance) return { version: 1, maintenance }
    }
    console.warn(`Ignoring invalid bot state at ${filePath}.`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`Ignoring unreadable bot state at ${filePath}.`, error)
    }
  }
  return { version: 1, maintenance: null }
}

function snapshot(pause: PersistedPause | null): MaintenanceStatus {
  if (!pause) {
    return {
      paused: false,
      pausedAt: null,
      pausedBy: null,
      reason: null,
      resumeAt: null,
    }
  }
  return {
    paused: true,
    pausedAt: new Date(pause.pausedAt),
    pausedBy: pause.pausedBy,
    reason: pause.reason,
    resumeAt: pause.resumeAt ? new Date(pause.resumeAt) : null,
  }
}

export class MaintenanceMode {
  #state: PersistedBotState
  #operation: Promise<void> = Promise.resolve()

  private constructor(
    private readonly filePath: string,
    state: PersistedBotState,
    private readonly now: () => Date,
  ) {
    this.#state = state
  }

  static async open(
    filePath: string,
    now: () => Date = () => new Date(),
  ): Promise<MaintenanceMode> {
    const mode = new MaintenanceMode(filePath, await readState(filePath), now)
    await mode.status()
    return mode
  }

  async status(): Promise<MaintenanceStatus> {
    return this.#mutate(async () => {
      if (this.#isExpired()) {
        const resumedState: PersistedBotState = { version: 1, maintenance: null }
        try {
          await this.#replaceState(resumedState)
        } catch (error) {
          this.#state = resumedState
          console.error('Could not persist automatic maintenance resume.', error)
        }
      }
      return snapshot(this.#state.maintenance)
    })
  }

  async pause(options: PauseMaintenanceOptions): Promise<MaintenanceStatus> {
    return this.#mutate(async () => {
      const pausedAt = this.now()
      const durationMinutes = options.durationMinutes ?? null
      if (
        durationMinutes !== null
        && (!Number.isFinite(durationMinutes) || durationMinutes <= 0)
      ) {
        throw new Error('Maintenance duration must be a positive number of minutes.')
      }
      await this.#replaceState({
        version: 1,
        maintenance: {
          pausedAt: pausedAt.toISOString(),
          pausedBy: options.pausedBy,
          reason: options.reason?.trim() || null,
          resumeAt: durationMinutes === null
            ? null
            : new Date(pausedAt.getTime() + durationMinutes * 60_000).toISOString(),
        },
      })
      return snapshot(this.#state.maintenance)
    })
  }

  async resume(): Promise<boolean> {
    return this.#mutate(async () => {
      const wasPaused = this.#state.maintenance !== null && !this.#isExpired()
      if (this.#state.maintenance !== null) {
        await this.#replaceState({ version: 1, maintenance: null })
      }
      return wasPaused
    })
  }

  #isExpired(): boolean {
    const resumeAt = this.#state.maintenance?.resumeAt
    return Boolean(resumeAt && Date.parse(resumeAt) <= this.now().getTime())
  }

  async #replaceState(state: PersistedBotState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, this.filePath)
    this.#state = state
  }

  async #mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operation.then(operation, operation)
    this.#operation = result.then(() => undefined, () => undefined)
    return result
  }
}
