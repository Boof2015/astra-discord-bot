import { applyAliases, loadAliases } from '../wiki/aliases.js'
import { parseWikiDirectory } from '../wiki/parser.js'
import { WikiSearchEngine } from './hybrid.js'
import { LexicalIndex } from './lexical.js'
import { EmbeddingGemmaModel, LocalSemanticIndex } from './semantic.js'

export interface CreateSearchEngineOptions {
  wikiDirectory: string
  wikiBaseUrl: string
  aliasesFile: string
  semanticEnabled: boolean
  embeddingModel: string
  modelCacheDirectory: string
  embeddingCacheFile: string
}

export interface CreatedSearchEngine {
  engine: WikiSearchEngine
  chunkCount: number
  semanticEnabled: boolean
}

export async function createSearchEngine(
  options: CreateSearchEngineOptions,
): Promise<CreatedSearchEngine> {
  const [parsedChunks, aliases] = await Promise.all([
    parseWikiDirectory(options.wikiDirectory, { baseUrl: options.wikiBaseUrl }),
    loadAliases(options.aliasesFile),
  ])
  const chunks = applyAliases(parsedChunks, aliases)
  const lexicalIndex = new LexicalIndex(chunks)

  if (!options.semanticEnabled) {
    return {
      engine: new WikiSearchEngine(lexicalIndex),
      chunkCount: chunks.length,
      semanticEnabled: false,
    }
  }

  try {
    if (options.embeddingModel.trim().toLocaleLowerCase() !== 'google/embeddinggemma-300m') {
      throw new Error(
        `Unsupported embedding model ${options.embeddingModel}. `
        + 'Use google/embeddinggemma-300m.',
      )
    }
    const embeddingModel = new EmbeddingGemmaModel(options.modelCacheDirectory)
    const semanticIndex = await LocalSemanticIndex.build({
      chunks,
      embeddingModel,
      cacheFile: options.embeddingCacheFile,
    })
    return {
      engine: new WikiSearchEngine(lexicalIndex, semanticIndex),
      chunkCount: chunks.length,
      semanticEnabled: true,
    }
  } catch (error) {
    console.error('Semantic search could not start; continuing with lexical search.', error)
    return {
      engine: new WikiSearchEngine(lexicalIndex),
      chunkCount: chunks.length,
      semanticEnabled: false,
    }
  }
}
