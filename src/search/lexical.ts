import type { WikiChunk } from '../wiki/types.js'
import { normalizeSearchPhrase, tokenize } from './tokenize.js'
import type { LexicalHit } from './types.js'

interface IndexedDocument {
  chunk: WikiChunk
  pageTitleFrequencies: Map<string, number>
  headingFrequencies: Map<string, number>
  pathFrequencies: Map<string, number>
  aliasFrequencies: Map<string, number>
  textFrequencies: Map<string, number>
  textLength: number
  weightedLength: number
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

function addTokens(target: Map<string, number>, source: string): number {
  const tokens = tokenize(source)
  for (const token of tokens) target.set(token, (target.get(token) ?? 0) + 1)
  return tokens.length
}

function exactQueryCandidates(normalizedQuery: string): string[] {
  if (!normalizedQuery) return []
  const candidates = new Set([normalizedQuery])
  const leadingPatterns = [
    /^(?:where is|where are) (?:the )?/,
    /^(?:where do i|where can i) (?:find|open|see|view|change|set|configure|adjust) (?:the )?/,
    /^how (?:do|can|could|should|would) i /,
    /^how (?:does|do) (?:the )?/,
    /^what (?:is|are|does) (?:the )?/,
    /^why (?:is|are|does) (?:the )?/,
    /^help me (?:with|understand|set up|configure) (?:the )?/,
    /^help (?:with|understand) (?:the )?/,
    /^tell me about (?:the )?/,
    /^explain (?:the )?/,
    /^show me (?:the )?/,
  ]
  const trailingPatterns = [
    / (?:in|inside|on|for) astra$/,
    / (?:work|do|settings|options|page|screen|menu)$/,
  ]

  for (const pattern of leadingPatterns) {
    const candidate = normalizedQuery.replace(pattern, '').trim()
    if (candidate && candidate !== normalizedQuery) candidates.add(candidate)
  }
  for (const candidate of [...candidates]) {
    const withoutArticle = candidate.replace(/^(?:the|my) /, '').trim()
    if (withoutArticle) candidates.add(withoutArticle)
    for (const pattern of trailingPatterns) {
      const shortened = candidate.replace(pattern, '').trim()
      if (shortened) candidates.add(shortened)
      const shortenedWithoutArticle = withoutArticle.replace(pattern, '').trim()
      if (shortenedWithoutArticle) candidates.add(shortenedWithoutArticle)
    }
  }
  return [...candidates]
}

function exactPhraseBoost(document: IndexedDocument, normalizedQuery: string): number {
  const candidates = exactQueryCandidates(normalizedQuery)
  if (candidates.length === 0) return 0
  if (document.normalizedAliases.some((alias) => candidates.includes(alias))) return 14
  if (candidates.includes(document.normalizedHeading)) return 12
  if (
    document.chunk.id === document.chunk.pageSlug
    && candidates.includes(document.normalizedTitle)
  ) return 10
  return 0
}

export class LexicalIndex {
  readonly #documents: IndexedDocument[]
  readonly #documentFrequency = new Map<string, number>()
  readonly #averageWeightedLength: number

  constructor(chunks: WikiChunk[]) {
    this.#documents = chunks.map((chunk) => {
      const pageTitleFrequencies = new Map<string, number>()
      const headingFrequencies = new Map<string, number>()
      const pathFrequencies = new Map<string, number>()
      const aliasFrequencies = new Map<string, number>()
      const textFrequencies = new Map<string, number>()
      const pageTitleLength = addTokens(pageTitleFrequencies, chunk.pageTitle)
      const headingLength = addTokens(headingFrequencies, chunk.heading)
      const pathLength = addTokens(pathFrequencies, chunk.headingPath.join(' '))
      let aliasLength = 0
      for (const alias of chunk.aliases) {
        aliasLength += addTokens(aliasFrequencies, alias)
      }
      const textLength = addTokens(textFrequencies, chunk.text)
      const weightedLength = pageTitleLength * FIELD_WEIGHTS.pageTitle
        + headingLength * FIELD_WEIGHTS.heading
        + pathLength * FIELD_WEIGHTS.path
        + aliasLength * FIELD_WEIGHTS.aliases
        + textLength * FIELD_WEIGHTS.text

      const allTokens = new Set([
        ...pageTitleFrequencies.keys(),
        ...headingFrequencies.keys(),
        ...pathFrequencies.keys(),
        ...aliasFrequencies.keys(),
        ...textFrequencies.keys(),
      ])
      for (const token of allTokens) {
        this.#documentFrequency.set(token, (this.#documentFrequency.get(token) ?? 0) + 1)
      }

      return {
        chunk,
        pageTitleFrequencies,
        headingFrequencies,
        pathFrequencies,
        aliasFrequencies,
        textFrequencies,
        textLength,
        weightedLength,
        normalizedTitle: normalizeSearchPhrase(chunk.pageTitle),
        normalizedHeading: normalizeSearchPhrase(chunk.heading),
        normalizedPath: normalizeSearchPhrase(chunk.headingPath.join(' ')),
        normalizedAliases: chunk.aliases.map(normalizeSearchPhrase),
      }
    })

    this.#averageWeightedLength = this.#documents.length > 0
      ? this.#documents.reduce((sum, document) => sum + document.weightedLength, 0) / this.#documents.length
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
      let matchedQueryTokenCount = 0
      let matchedMetadataTokenCount = 0
      for (const token of uniqueQueryTokens) {
        const titleFrequency = document.pageTitleFrequencies.get(token) ?? 0
        const headingFrequency = document.headingFrequencies.get(token) ?? 0
        const pathFrequency = document.pathFrequencies.get(token) ?? 0
        const aliasFrequency = document.aliasFrequencies.get(token) ?? 0
        const textFrequency = document.textFrequencies.get(token) ?? 0
        if (
          titleFrequency === 0
          && headingFrequency === 0
          && pathFrequency === 0
          && aliasFrequency === 0
          && textFrequency === 0
        ) continue
        matchedQueryTokenCount += 1
        if (titleFrequency + headingFrequency + pathFrequency + aliasFrequency > 0) {
          matchedMetadataTokenCount += 1
        }
        const documentFrequency = this.#documentFrequency.get(token) ?? 0
        const inverseDocumentFrequency = Math.log(
          1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5),
        )
        const termFrequency = titleFrequency * FIELD_WEIGHTS.pageTitle
          + headingFrequency * FIELD_WEIGHTS.heading
          + pathFrequency * FIELD_WEIGHTS.path
          + aliasFrequency * FIELD_WEIGHTS.aliases
          + textFrequency * FIELD_WEIGHTS.text
        const lengthNormalization = BM25_K1 * (
          1 - BM25_B + BM25_B * document.weightedLength / this.#averageWeightedLength
        )
        score += inverseDocumentFrequency
          * (termFrequency * (BM25_K1 + 1))
          / (termFrequency + lengthNormalization)
      }

      const exactBoost = exactPhraseBoost(document, normalizedQuery)
      score += exactBoost
      if (score > 0) {
        hits.push({
          chunk: document.chunk,
          score,
          exactBoost,
          queryTokenCount: uniqueQueryTokens.length,
          matchedQueryTokenCount,
          matchedMetadataTokenCount,
        })
      }
    }

    return hits
      .sort((left, right) => right.score - left.score || left.chunk.id.localeCompare(right.chunk.id))
      .slice(0, Math.max(0, limit))
  }
}
