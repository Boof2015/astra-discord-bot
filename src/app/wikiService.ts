import type { BotConfig } from '../config.js'
import { createSearchEngine } from '../search/createEngine.js'
import type { WikiSearchEngine } from '../search/hybrid.js'
import type { WikiSearchResponse } from '../search/types.js'
import { WikiRepository } from '../wiki/repository.js'

export interface WikiServiceStatus {
  commit: string | null
  chunkCount: number
  semanticEnabled: boolean
  refreshedAt: Date | null
}

export class WikiService {
  readonly #repository: WikiRepository
  #engine: WikiSearchEngine | null = null
  #refreshPromise: Promise<void> | null = null
  #timer: NodeJS.Timeout | null = null
  #status: WikiServiceStatus = {
    commit: null,
    chunkCount: 0,
    semanticEnabled: false,
    refreshedAt: null,
  }

  constructor(private readonly config: BotConfig) {
    this.#repository = new WikiRepository(
      config.wikiDirectory,
      config.wikiRemoteUrl,
      config.wikiSyncEnabled,
    )
  }

  status(): WikiServiceStatus {
    return { ...this.#status }
  }

  async start(): Promise<void> {
    await this.refresh(true)
    this.#timer = setInterval(() => {
      void this.refresh(false).catch((error) => {
        console.error(
          `Periodic ${this.config.identity.wikiLabel} refresh failed; keeping the previous index.`,
          error,
        )
      })
    }, this.config.wikiPollMilliseconds)
    this.#timer.unref()
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = null
  }

  async refresh(force: boolean): Promise<void> {
    if (this.#refreshPromise) return this.#refreshPromise
    this.#refreshPromise = this.#performRefresh(force).finally(() => {
      this.#refreshPromise = null
    })
    return this.#refreshPromise
  }

  async #performRefresh(force: boolean): Promise<void> {
    const sync = await this.#repository.sync()
    if (!force && !sync.changed && this.#engine) return

    const created = await createSearchEngine({
      productName: this.config.identity.productName,
      wikiDirectory: this.config.wikiDirectory,
      wikiBaseUrl: this.config.wikiBaseUrl,
      aliasesFile: this.config.aliasesFile,
      semanticEnabled: this.config.semanticEnabled,
      embeddingModel: this.config.embeddingModel,
      modelCacheDirectory: this.config.modelCacheDirectory,
      embeddingCacheFile: this.config.embeddingCacheFile,
    })

    this.#engine = created.engine
    this.#status = {
      commit: sync.commit,
      chunkCount: created.chunkCount,
      semanticEnabled: created.semanticEnabled,
      refreshedAt: new Date(),
    }
    console.info(
      `${this.config.identity.wikiLabel} index ready: ${created.chunkCount} sections, `
      + `${created.semanticEnabled ? 'hybrid' : 'lexical-only'} search, commit ${sync.commit}.`,
    )
  }

  async search(query: string, limit = 3): Promise<WikiSearchResponse> {
    if (!this.#engine) throw new Error('The Wiki index is not ready.')
    return this.#engine.search(query, limit)
  }
}
