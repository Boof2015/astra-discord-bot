import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { AutoModel, AutoTokenizer, env } from '@huggingface/transformers'
import type { WikiChunk } from '../wiki/types.js'
import type { SemanticHit, SemanticSearcher } from './types.js'

interface EmbeddingCacheFile {
  version: 1
  model: string
  vectors: Record<string, number[]>
}

interface ChunkVector {
  chunk: WikiChunk
  vector: number[]
}

interface TensorLike {
  tolist(): unknown
}

interface EmbeddingGemmaOutput {
  sentence_embedding: TensorLike
}

type EmbeddingGemmaTokenizer = (
  texts: string[],
  options: { padding: boolean; truncation: boolean },
) => unknown

type EmbeddingGemmaCallable = (inputs: unknown) => Promise<EmbeddingGemmaOutput>

const MAX_EMBEDDING_TEXT_LENGTH = 2_400
const DEFAULT_BATCH_SIZE = 16
const EMBEDDING_GEMMA_MODEL = 'google/embeddinggemma-300m'
const EMBEDDING_GEMMA_REPOSITORY = 'onnx-community/embeddinggemma-300m-ONNX'
const EMBEDDING_GEMMA_REVISION = '5090578d9565bb06545b4552f76e6bc2c93e4a66'
const EMBEDDING_GEMMA_DTYPE = 'q8'

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
}

function numberMatrix(value: unknown): number[][] | null {
  if (!Array.isArray(value) || !value.every(isNumberArray)) return null
  return value
}

function embeddingText(chunk: WikiChunk): string {
  const parts = [
    chunk.headingPath.join(' > '),
    chunk.aliases.join('; '),
    chunk.text,
  ].filter(Boolean)
  return parts.join('\n').slice(0, MAX_EMBEDDING_TEXT_LENGTH)
}

function documentPrompt(chunk: WikiChunk): string {
  return `title: ${chunk.pageTitle} | text: ${embeddingText(chunk)}`
}

function embeddingHash(model: string, chunk: WikiChunk): string {
  return createHash('sha256')
    .update(`${model}\n${chunk.id}\n${documentPrompt(chunk)}`)
    .digest('hex')
}

function dotProduct(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length)
  let total = 0
  for (let index = 0; index < length; index += 1) {
    total += (left[index] ?? 0) * (right[index] ?? 0)
  }
  return total
}

async function readCache(filePath: string, model: string): Promise<EmbeddingCacheFile> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'))
    if (
      parsed
      && typeof parsed === 'object'
      && 'version' in parsed
      && parsed.version === 1
      && 'model' in parsed
      && parsed.model === model
      && 'vectors' in parsed
      && parsed.vectors
      && typeof parsed.vectors === 'object'
      && !Array.isArray(parsed.vectors)
    ) {
      return parsed as EmbeddingCacheFile
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`Ignoring unreadable embedding cache at ${filePath}.`, error)
    }
  }
  return { version: 1, model, vectors: {} }
}

async function writeCache(filePath: string, cache: EmbeddingCacheFile): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(cache)}\n`, 'utf8')
  await rename(temporaryPath, filePath)
}

export class EmbeddingGemmaModel {
  readonly model = [
    EMBEDDING_GEMMA_MODEL,
    EMBEDDING_GEMMA_DTYPE,
    EMBEDDING_GEMMA_REVISION,
  ].join('@')
  readonly minimumSimilarity = 0.3
  readonly strongSimilarity = 0.55
  #runtimePromise: Promise<{
    tokenizer: EmbeddingGemmaTokenizer
    model: EmbeddingGemmaCallable
  }> | null = null

  constructor(private readonly cacheDirectory: string) {}

  async #runtime(): Promise<{
    tokenizer: EmbeddingGemmaTokenizer
    model: EmbeddingGemmaCallable
  }> {
    if (!this.#runtimePromise) {
      this.#runtimePromise = (async () => {
        env.cacheDir = this.cacheDirectory
        const tokenizer = await AutoTokenizer.from_pretrained(EMBEDDING_GEMMA_REPOSITORY, {
          revision: EMBEDDING_GEMMA_REVISION,
        })
        const model = await AutoModel.from_pretrained(EMBEDDING_GEMMA_REPOSITORY, {
          dtype: EMBEDDING_GEMMA_DTYPE,
          revision: EMBEDDING_GEMMA_REVISION,
        })
        return {
          tokenizer: tokenizer as unknown as EmbeddingGemmaTokenizer,
          model: model as unknown as EmbeddingGemmaCallable,
        }
      })()
    }
    return this.#runtimePromise
  }

  async #embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    const runtime = await this.#runtime()
    const inputs = runtime.tokenizer(texts, { padding: true, truncation: true })
    const output = await runtime.model(inputs)
    const vectors = numberMatrix(output.sentence_embedding.tolist())
    if (!vectors || vectors.length !== texts.length) {
      throw new Error('EmbeddingGemma returned an invalid embedding matrix.')
    }
    return vectors
  }

  async embedDocuments(chunks: WikiChunk[]): Promise<number[][]> {
    const vectors: number[][] = []
    for (let offset = 0; offset < chunks.length; offset += DEFAULT_BATCH_SIZE) {
      const batch = chunks.slice(offset, offset + DEFAULT_BATCH_SIZE).map(documentPrompt)
      vectors.push(...await this.#embed(batch))
    }
    return vectors
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.#embed([`task: search result | query: ${text}`])
    if (!vector) throw new Error('EmbeddingGemma returned no query vector.')
    return vector
  }
}

export class LocalSemanticIndex implements SemanticSearcher {
  readonly minimumSimilarity: number
  readonly strongSimilarity: number

  private constructor(
    private readonly embeddingModel: EmbeddingGemmaModel,
    private readonly chunkVectors: ChunkVector[],
  ) {
    this.minimumSimilarity = embeddingModel.minimumSimilarity
    this.strongSimilarity = embeddingModel.strongSimilarity
  }

  static async build(options: {
    chunks: WikiChunk[]
    embeddingModel: EmbeddingGemmaModel
    cacheFile: string
    batchSize?: number
  }): Promise<LocalSemanticIndex> {
    const cache = await readCache(options.cacheFile, options.embeddingModel.model)
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
    const chunkVectors: ChunkVector[] = []
    const missing: Array<{ chunk: WikiChunk; hash: string }> = []

    for (const chunk of options.chunks) {
      const hash = embeddingHash(options.embeddingModel.model, chunk)
      const cachedVector = cache.vectors[hash]
      if (cachedVector && isNumberArray(cachedVector)) {
        chunkVectors.push({ chunk, vector: cachedVector })
      } else {
        missing.push({ chunk, hash })
      }
    }

    for (let offset = 0; offset < missing.length; offset += batchSize) {
      const batch = missing.slice(offset, offset + batchSize)
      const vectors = await options.embeddingModel.embedDocuments(
        batch.map(({ chunk }) => chunk),
      )
      batch.forEach((entry, index) => {
        const vector = vectors[index]
        if (!vector) throw new Error(`Missing embedding for ${entry.chunk.id}.`)
        cache.vectors[entry.hash] = vector
        chunkVectors.push({ chunk: entry.chunk, vector })
      })
    }

    if (missing.length > 0) await writeCache(options.cacheFile, cache)
    chunkVectors.sort((left, right) => left.chunk.id.localeCompare(right.chunk.id))
    return new LocalSemanticIndex(options.embeddingModel, chunkVectors)
  }

  async search(query: string, limit: number): Promise<SemanticHit[]> {
    const queryVector = await this.embeddingModel.embedQuery(query)
    return this.chunkVectors
      .map(({ chunk, vector }) => ({ chunk, similarity: dotProduct(queryVector, vector) }))
      .sort((left, right) => (
        right.similarity - left.similarity || left.chunk.id.localeCompare(right.chunk.id)
      ))
      .slice(0, Math.max(0, limit))
  }
}
