import { LexicalIndex } from './lexical.js'
import type {
  LexicalHit,
  RankedWikiResult,
  SearchConfidence,
  SemanticHit,
  SemanticSearcher,
  WikiSearchResponse,
} from './types.js'

const STRONG_LEXICAL_SCORE = 8
const SEMANTIC_ONLY_SIMILARITY = 0.84

interface MutableFusionResult {
  chunk: LexicalHit['chunk']
  score: number
  lexicalRank: number | null
  lexicalScore: number | null
  semanticRank: number | null
  semanticSimilarity: number | null
  exactBoost: number
  queryTokenCount: number
  matchedQueryTokenCount: number
  matchedMetadataTokenCount: number
}

function classifyConfidence(
  results: RankedWikiResult[],
  semanticSearcher: SemanticSearcher | null,
): SearchConfidence {
  const first = results[0]
  if (!first) return 'low'
  const second = results[1]
  const margin = second ? first.score - second.score : 1
  const lexicalSemanticAgreement = first.lexicalRank !== null
    && first.lexicalRank <= 3
    && first.semanticRank !== null
    && first.semanticRank <= 3

  const strongSimilarity = semanticSearcher?.strongSimilarity ?? 0.88
  const minimumSimilarity = semanticSearcher?.minimumSimilarity ?? SEMANTIC_ONLY_SIMILARITY
  if (
    first.exactBoost >= 10
    || (
      first.semanticSimilarity !== null
      && first.semanticSimilarity >= strongSimilarity
      && margin >= 0.025
    )
    || (lexicalSemanticAgreement && margin >= 0.08)
  ) return 'high'
  if (
    first.exactBoost > 0
    || (!semanticSearcher && first.lexicalRank !== null && first.lexicalRank <= 5)
    || (
      first.semanticSimilarity !== null
      && first.semanticSimilarity >= minimumSimilarity
    )
  ) return 'medium'
  return 'low'
}

function hasEnoughEvidence(
  results: RankedWikiResult[],
  semanticSearcher: SemanticSearcher | null,
): boolean {
  const first = results[0]
  if (!first) return false
  if (first.exactBoost > 0) return true

  if (semanticSearcher && first.semanticSimilarity !== null) {
    return first.semanticSimilarity
      >= (semanticSearcher.minimumSimilarity ?? SEMANTIC_ONLY_SIMILARITY)
  }

  const lexicalScore = first.lexicalScore ?? 0
  if (lexicalScore >= STRONG_LEXICAL_SCORE) return true
  return false
}

function addLexicalHits(
  target: Map<string, MutableFusionResult>,
  hits: LexicalHit[],
  semanticActive: boolean,
): void {
  hits.forEach((hit, index) => {
    const rank = index + 1
    const exactOverride = semanticActive && hit.exactBoost >= 10
      ? 1 + hit.exactBoost / 100
      : 0
    target.set(hit.chunk.id, {
      chunk: hit.chunk,
      score: semanticActive ? exactOverride : hit.score,
      lexicalRank: rank,
      lexicalScore: hit.score,
      semanticRank: null,
      semanticSimilarity: null,
      exactBoost: hit.exactBoost,
      queryTokenCount: hit.queryTokenCount,
      matchedQueryTokenCount: hit.matchedQueryTokenCount,
      matchedMetadataTokenCount: hit.matchedMetadataTokenCount,
    })
  })
}

function addSemanticHits(target: Map<string, MutableFusionResult>, hits: SemanticHit[]): void {
  hits.forEach((hit, index) => {
    const rank = index + 1
    const existing = target.get(hit.chunk.id)
    if (existing) {
      if (existing.exactBoost < 10) existing.score = hit.similarity
      existing.semanticRank = rank
      existing.semanticSimilarity = hit.similarity
      return
    }

    target.set(hit.chunk.id, {
      chunk: hit.chunk,
      score: hit.similarity,
      lexicalRank: null,
      lexicalScore: null,
      semanticRank: rank,
      semanticSimilarity: hit.similarity,
      exactBoost: 0,
      queryTokenCount: 0,
      matchedQueryTokenCount: 0,
      matchedMetadataTokenCount: 0,
    })
  })
}

export class WikiSearchEngine {
  constructor(
    private readonly lexicalIndex: LexicalIndex,
    private readonly semanticSearcher: SemanticSearcher | null = null,
  ) {}

  async search(query: string, limit = 3): Promise<WikiSearchResponse> {
    const trimmedQuery = query.trim()
    if (!trimmedQuery) return { query: trimmedQuery, confidence: 'low', results: [] }

    const lexicalHits = this.lexicalIndex.search(trimmedQuery, 50)
    const semanticHits = this.semanticSearcher
      ? await this.semanticSearcher.search(trimmedQuery, 50)
      : []
    const fused = new Map<string, MutableFusionResult>()
    addLexicalHits(fused, lexicalHits, semanticHits.length > 0)
    addSemanticHits(fused, semanticHits)

    const results = [...fused.values()]
      .sort((left, right) => right.score - left.score || left.chunk.id.localeCompare(right.chunk.id))
      .slice(0, Math.max(0, limit))

    if (!hasEnoughEvidence(results, this.semanticSearcher)) {
      return { query: trimmedQuery, confidence: 'low', results: [] }
    }

    return {
      query: trimmedQuery,
      confidence: classifyConfidence(results, this.semanticSearcher),
      results,
    }
  }
}
