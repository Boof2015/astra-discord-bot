import type { WikiChunk } from '../wiki/types.js'

export interface LexicalHit {
  chunk: WikiChunk
  score: number
  exactBoost: number
  queryTokenCount: number
  matchedQueryTokenCount: number
  matchedMetadataTokenCount: number
}

export interface SemanticHit {
  chunk: WikiChunk
  similarity: number
}

export interface RankedWikiResult {
  chunk: WikiChunk
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

export type SearchConfidence = 'high' | 'medium' | 'low'

export interface WikiSearchResponse {
  query: string
  confidence: SearchConfidence
  results: RankedWikiResult[]
}

export interface SemanticSearcher {
  readonly minimumSimilarity?: number
  readonly strongSimilarity?: number
  search(query: string, limit: number): Promise<SemanticHit[]>
}
