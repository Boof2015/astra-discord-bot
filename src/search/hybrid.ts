import { LexicalIndex } from './lexical.js'
import type {
  LexicalHit,
  RankedWikiResult,
  SearchConfidence,
  SemanticHit,
  SemanticSearcher,
  WikiSearchResponse,
} from './types.js'

const FUSION_K = 45
const LEXICAL_WEIGHT = 1.2
const SEMANTIC_WEIGHT = 1
const LEXICAL_SCORE_BONUS = 0.012

interface MutableFusionResult {
  chunk: LexicalHit['chunk']
  score: number
  lexicalRank: number | null
  lexicalScore: number | null
  semanticRank: number | null
  semanticSimilarity: number | null
  exactBoost: number
}

function classifyConfidence(results: RankedWikiResult[]): SearchConfidence {
  const first = results[0]
  if (!first) return 'low'
  const second = results[1]
  const margin = second ? (first.score - second.score) / Math.max(first.score, Number.EPSILON) : 1
  const lexicalSemanticAgreement = first.lexicalRank !== null
    && first.lexicalRank <= 3
    && first.semanticRank !== null
    && first.semanticRank <= 3

  if (first.exactBoost >= 10 || (lexicalSemanticAgreement && margin >= 0.08)) return 'high'
  if (
    first.exactBoost > 0
    || (first.lexicalRank !== null && first.lexicalRank <= 5)
    || (first.semanticSimilarity !== null && first.semanticSimilarity >= 0.42)
  ) return 'medium'
  return 'low'
}

function addLexicalHits(target: Map<string, MutableFusionResult>, hits: LexicalHit[]): void {
  const strongestLexicalScore = hits[0]?.score ?? 0
  hits.forEach((hit, index) => {
    const rank = index + 1
    const relativeLexicalStrength = strongestLexicalScore > 0
      ? hit.score / strongestLexicalScore
      : 0
    target.set(hit.chunk.id, {
      chunk: hit.chunk,
      score: LEXICAL_WEIGHT / (FUSION_K + rank)
        + relativeLexicalStrength * LEXICAL_SCORE_BONUS
        + hit.exactBoost * 0.004,
      lexicalRank: rank,
      lexicalScore: hit.score,
      semanticRank: null,
      semanticSimilarity: null,
      exactBoost: hit.exactBoost,
    })
  })
}

function addSemanticHits(target: Map<string, MutableFusionResult>, hits: SemanticHit[]): void {
  hits.forEach((hit, index) => {
    const rank = index + 1
    const existing = target.get(hit.chunk.id)
    if (existing) {
      existing.score += SEMANTIC_WEIGHT / (FUSION_K + rank)
      existing.semanticRank = rank
      existing.semanticSimilarity = hit.similarity
      return
    }

    target.set(hit.chunk.id, {
      chunk: hit.chunk,
      score: SEMANTIC_WEIGHT / (FUSION_K + rank),
      lexicalRank: null,
      lexicalScore: null,
      semanticRank: rank,
      semanticSimilarity: hit.similarity,
      exactBoost: 0,
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
    addLexicalHits(fused, lexicalHits)
    addSemanticHits(fused, semanticHits)

    const results = [...fused.values()]
      .sort((left, right) => right.score - left.score || left.chunk.id.localeCompare(right.chunk.id))
      .slice(0, Math.max(0, limit))

    return {
      query: trimmedQuery,
      confidence: classifyConfidence(results),
      results,
    }
  }
}
