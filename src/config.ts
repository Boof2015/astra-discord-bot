import { resolve } from 'node:path'

export interface BotConfig {
  discordToken: string
  discordClientId: string
  discordGuildId: string | null
  wikiRemoteUrl: string
  wikiBaseUrl: string
  wikiDirectory: string
  wikiSyncEnabled: boolean
  wikiPollMilliseconds: number
  aliasesFile: string
  semanticEnabled: boolean
  embeddingModel: string
  modelCacheDirectory: string
  embeddingCacheFile: string
}

function booleanFromEnvironment(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLocaleLowerCase()
  if (!value) return fallback
  if (['1', 'true', 'yes', 'on'].includes(value)) return true
  if (['0', 'false', 'no', 'off'].includes(value)) return false
  throw new Error(`${name} must be true or false.`)
}

function positiveNumberFromEnvironment(name: string, fallback: number): number {
  const value = process.env[name]?.trim()
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number.`)
  return parsed
}

function requiredEnvironmentValue(name: string, required: boolean): string {
  const value = process.env[name]?.trim() ?? ''
  if (required && !value) throw new Error(`${name} is required.`)
  return value
}

export function loadLocalEnvironment(): void {
  try {
    process.loadEnvFile('.env')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export function loadConfig(options: { requireDiscord?: boolean } = {}): BotConfig {
  const requireDiscord = options.requireDiscord ?? true
  const pollMinutes = positiveNumberFromEnvironment('WIKI_POLL_MINUTES', 5)
  return {
    discordToken: requiredEnvironmentValue('DISCORD_TOKEN', requireDiscord),
    discordClientId: requiredEnvironmentValue('DISCORD_CLIENT_ID', requireDiscord),
    discordGuildId: process.env.DISCORD_GUILD_ID?.trim() || null,
    wikiRemoteUrl: process.env.WIKI_REMOTE_URL?.trim()
      || 'https://github.com/Boof2015/astra.wiki.git',
    wikiBaseUrl: process.env.WIKI_BASE_URL?.trim()
      || 'https://github.com/Boof2015/astra/wiki',
    wikiDirectory: resolve(process.env.WIKI_DIRECTORY?.trim() || './data/wiki'),
    wikiSyncEnabled: booleanFromEnvironment('WIKI_SYNC_ENABLED', true),
    wikiPollMilliseconds: Math.max(60_000, pollMinutes * 60_000),
    aliasesFile: resolve(process.env.ALIASES_FILE?.trim() || './config/aliases.yml'),
    semanticEnabled: booleanFromEnvironment('SEMANTIC_SEARCH_ENABLED', true),
    embeddingModel: process.env.EMBEDDING_MODEL?.trim()
      || 'sentence-transformers/all-MiniLM-L6-v2',
    modelCacheDirectory: resolve(
      process.env.MODEL_CACHE_DIRECTORY?.trim() || './data/model-cache',
    ),
    embeddingCacheFile: resolve(
      process.env.EMBEDDING_CACHE_FILE?.trim() || './data/embeddings.json',
    ),
  }
}
