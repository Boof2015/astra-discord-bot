import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'

export type StatusProduct = 'astra' | 'prism'

export interface StatusPair {
  id: string
  astra: string
  prism: string
}

export interface StatusCatalog {
  rotationMinutes: number
  reunionMinutes: number
  pairChance: number
  seed: string
  solos: Record<StatusProduct, string[]>
  partnerMissing: Record<StatusProduct, string[]>
  // Keyed by the bot returning; each entry contains both bots' lines.
  partnerReturned: Record<StatusProduct, StatusPair[]>
  pairs: StatusPair[]
}

function mapping(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be a mapping.`)
  }
  return value as Record<string, unknown>
}

function statusLine(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 128 || /[\r\n]/.test(value)) {
    throw new Error(`${name} must be a single line of 1-128 characters.`)
  }
  return value.trim()
}

function statusLists(value: unknown, name: string): Record<StatusProduct, string[]> {
  const source = mapping(value, name)
  const lists = {} as Record<StatusProduct, string[]>
  for (const product of ['astra', 'prism'] as const) {
    const entries = source[product]
    if (!Array.isArray(entries)) throw new Error(`${name}.${product} must be a list.`)
    lists[product] = [...new Set(entries.map((entry, index) => statusLine(entry, `${name}.${product}[${index}]`)))]
  }
  return lists
}

function statusPairs(value: unknown, name: string): StatusPair[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be a list.`)
  const pairIds = new Set<string>()
  return value.map((entry, index) => {
    const pair = mapping(entry, `${name}[${index}]`)
    const id = statusLine(pair.id, `${name}[${index}].id`)
    if (pairIds.has(id)) throw new Error(`Duplicate status pair ID in ${name}: ${id}`)
    pairIds.add(id)
    return {
      id,
      astra: statusLine(pair.astra, `${name}[${index}].astra`),
      prism: statusLine(pair.prism, `${name}[${index}].prism`),
    }
  })
}

export function parseStatusCatalog(value: unknown): StatusCatalog {
  const source = mapping(value, 'Status catalog')
  const rotationMinutes = source.rotationMinutes ?? 10
  const reunionMinutes = source.reunionMinutes ?? 2
  const pairChance = source.pairChance ?? 0.15
  if (typeof rotationMinutes !== 'number' || !Number.isFinite(rotationMinutes)
    || rotationMinutes < 1 || rotationMinutes > 1_440) {
    throw new Error('rotationMinutes must be between 1 and 1440.')
  }
  if (typeof reunionMinutes !== 'number' || !Number.isFinite(reunionMinutes)
    || reunionMinutes < 1 || reunionMinutes > 60) {
    throw new Error('reunionMinutes must be between 1 and 60.')
  }
  if (typeof pairChance !== 'number' || !Number.isFinite(pairChance) || pairChance < 0 || pairChance > 1) {
    throw new Error('pairChance must be between 0 and 1.')
  }
  const seed = statusLine(source.seed ?? 'astra-prism-statuses-v1', 'seed')
  const solos = statusLists(source.solos, 'solos')
  const partnerMissing = statusLists(source.partnerMissing ?? { astra: [], prism: [] }, 'partnerMissing')
  const rawReturns = mapping(source.partnerReturned ?? { astra: [], prism: [] }, 'partnerReturned')
  const partnerReturned = {
    astra: statusPairs(rawReturns.astra, 'partnerReturned.astra'),
    prism: statusPairs(rawReturns.prism, 'partnerReturned.prism'),
  }
  const pairs = statusPairs(source.pairs, 'pairs')
  const hasPairs = pairs.length + partnerReturned.astra.length + partnerReturned.prism.length > 0
  if (hasPairs && (!solos.astra.length || !solos.prism.length)) {
    throw new Error('Both bots need solo statuses to fall back to when pairs are configured.')
  }
  return { rotationMinutes, reunionMinutes, pairChance, seed, solos, partnerMissing, partnerReturned, pairs }
}

export async function loadStatusCatalog(path: string): Promise<StatusCatalog> {
  return parseStatusCatalog(parse(await readFile(path, 'utf8')))
}

export function statusCatalogFingerprint(catalog: StatusCatalog): string {
  return createHash('sha256').update(JSON.stringify(catalog)).digest('hex')
}

function randomFraction(key: string): number {
  return createHash('sha256').update(key).digest().readUInt32BE(0) / 0x1_0000_0000
}

export function planStatus(catalog: StatusCatalog, product: StatusProduct, now: number) {
  const slot = Math.floor(now / (catalog.rotationMinutes * 60_000))
  const key = `${catalog.seed}:${slot}`
  const solos = catalog.solos[product]
  const soloIndex = Math.floor(randomFraction(`${key}:solo:${product}`) * solos.length)
  const missingLines = catalog.partnerMissing[product]
  const missingIndex = Math.floor(randomFraction(`${key}:missing:${product}`) * missingLines.length)
  const pair = randomFraction(`${key}:paired`) < catalog.pairChance
    ? catalog.pairs[Math.floor(randomFraction(`${key}:pair`) * catalog.pairs.length)] ?? null
    : null
  return {
    slot, pair,
    soloIndex, solo: solos[soloIndex] ?? null,
    missingIndex, missing: missingLines[missingIndex] ?? null,
  }
}

export function selectReunionPair(
  catalog: StatusCatalog, returning: StatusProduct, eventId: string, previousId?: string,
): StatusPair | null {
  const pairs = catalog.partnerReturned[returning]
  let index = Math.floor(randomFraction(`${catalog.seed}:reunion:${returning}:${eventId}`) * pairs.length)
  if (pairs.length > 1 && pairs[index]?.id === previousId) index = (index + 1) % pairs.length
  return pairs[index] ?? null
}
