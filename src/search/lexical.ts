import type { WikiChunk } from '../wiki/types.js'
import { normalizeSearchPhrase, tokenize } from './tokenize.js'
import type { LexicalHit } from './types.js'

interface IndexedDocument {
  chunk: WikiChunk
  frequencies: Map<string, number>
  length: number
  normalizedTitle: string
  normalizedHeading: string
  normalizedPath: string
  normalizedAliases: string[]
}

const FIELD_WEIGHTS = {
  pageTitle: 3,
  heading: 5,
  path: 2,
  aliases: 7,
  text: 1,
} as const

const BM25_K1 = 1.35
const BM25_B = 0.72

function addTokens(target: Map<string, number>, source: string, weight: number): number {
  const tokens = tokenize(source)
  for (const token of tokens) target.set(token, (target.get(token) ?? 0) + weight)
  return tokens.length * weight
}

function exactPhraseBoost(document: IndexedDocument, normalizedQuery: string): number {
  if (!normalizedQuery) return 0
  if (document.normalizedAliases.some((alias) => alias === normalizedQuery)) return 14
  if (document.normalizedHeading === normalizedQuery) return 12
  if (document.normalizedTitle === normalizedQuery) return 10
  if (document.normalizedAliases.some((alias) => alias.includes(normalizedQuery))) return 8
  if (document.normalizedHeading.includes(normalizedQuery)) return 7
  if (document.normalizedPath.includes(normalizedQuery)) return 5
  const containedAlias = document.normalizedAliases
    .filter((alias) => alias.length >= 3 && normalizedQuery.includes(alias))
    .sort((left, right) => right.length - left.length)[0]
  if (containedAlias) return containedAlias.includes(' ') ? 9 : 4
  return 0
}

export class LexicalIndex {
  readonly #documents: IndexedDocument[]
  readonly #documentFrequency = new Map<string, number>()
  readonly #averageLength: number

  constructor(chunks: WikiChunk[]) {
    this.#documents = chunks.map((chunk) => {
      const frequencies = new Map<string, number>()
      let length = 0
      length += addTokens(frequencies, chunk.pageTitle, FIELD_WEIGHTS.pageTitle)
      length += addTokens(frequencies, chunk.heading, FIELD_WEIGHTS.heading)
      length += addTokens(frequencies, chunk.headingPath.join(' '), FIELD_WEIGHTS.path)
      for (const alias of chunk.aliases) {
        length += addTokens(frequencies, alias, FIELD_WEIGHTS.aliases)
      }
      length += addTokens(frequencies, chunk.text, FIELD_WEIGHTS.text)

      for (const token of frequencies.keys()) {
        this.#documentFrequency.set(token, (this.#documentFrequency.get(token) ?? 0) + 1)
      }

      return {
        chunk,
        frequencies,
        length,
        normalizedTitle: normalizeSearchPhrase(chunk.pageTitle),
        normalizedHeading: normalizeSearchPhrase(chunk.heading),
        normalizedPath: normalizeSearchPhrase(chunk.headingPath.join(' ')),
        normalizedAliases: chunk.aliases.map(normalizeSearchPhrase),
      }
    })

    this.#averageLength = this.#documents.length > 0
      ? this.#documents.reduce((sum, document) => sum + document.length, 0) / this.#documents.length
      : 1
  }

  search(query: string, limit = 50): LexicalHit[] {
    const queryTokens = tokenize(query)
    const normalizedQuery = normalizeSearchPhrase(query)
    if (queryTokens.length === 0 && !normalizedQuery) return []

    const uniqueQueryTokens = [...new Set(queryTokens)]
    const hits: LexicalHit[] = []
    const documentCount = this.#documents.length

    for (const document of this.#documents) {
      let score = 0
      for (const token of uniqueQueryTokens) {
        const termFrequency = document.frequencies.get(token) ?? 0
        if (termFrequency === 0) continue
        const documentFrequency = this.#documentFrequency.get(token) ?? 0
        const inverseDocumentFrequency = Math.log(
          1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5),
        )
        const lengthNormalization = BM25_K1 * (
          1 - BM25_B + BM25_B * document.length / this.#averageLength
        )
        score += inverseDocumentFrequency
          * (termFrequency * (BM25_K1 + 1))
          / (termFrequency + lengthNormalization)
      }

      const exactBoost = exactPhraseBoost(document, normalizedQuery)
      score += exactBoost
      if (score > 0) hits.push({ chunk: document.chunk, score, exactBoost })
    }

    return hits
      .sort((left, right) => right.score - left.score || left.chunk.id.localeCompare(right.chunk.id))
      .slice(0, Math.max(0, limit))
  }
}
