import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { createRequire } from 'node:module'
import { access, mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { FlagEmbedding as FlagEmbeddingInstance } from 'fastembed'
import * as tar from 'tar'
import type { WikiChunk } from '../wiki/types.js'
import type { SemanticHit, SemanticSearcher } from './types.js'

const require = createRequire(import.meta.url)
const { EmbeddingModel, ExecutionProvider, FlagEmbedding } = require('fastembed') as typeof import('fastembed')

interface EmbeddingCacheFile {
  version: 1
  model: string
  vectors: Record<string, number[]>
}

interface ChunkVector {
  chunk: WikiChunk
  vector: number[]
}

const MAX_EMBEDDING_TEXT_LENGTH = 2_400
const DEFAULT_BATCH_SIZE = 16
const FASTEMBED_MODEL_DIRECTORY = 'fast-all-MiniLM-L6-v2'
const FASTEMBED_MODEL_ARCHIVE = `${FASTEMBED_MODEL_DIRECTORY}.tar.gz`
const FASTEMBED_MODEL_DOWNLOAD_NAME = 'sentence-transformers-all-MiniLM-L6-v2.tar.gz'
const FASTEMBED_MODEL_URL = `https://storage.googleapis.com/qdrant-fastembed/${FASTEMBED_MODEL_DOWNLOAD_NAME}`
const FASTEMBED_MODEL_SHA256 = '2735afe656e156af64ed603dbb1c96f3cae7f937286a8feb27fff7fa979f6a77'
const MAX_MODEL_ARCHIVE_BYTES = 128 * 1024 * 1024
const REQUIRED_MODEL_FILES = [
  'config.json',
  'model.onnx',
  'special_tokens_map.json',
  'tokenizer.json',
  'tokenizer_config.json',
] as const

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
}

function normalizedNumberArray(value: unknown): number[] | null {
  if (isNumberArray(value)) return value
  if (ArrayBuffer.isView(value) && Symbol.iterator in value) {
    const converted = Array.from(value as unknown as Iterable<number>)
    return converted.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
      ? converted
      : null
  }
  return null
}

function embeddingText(chunk: WikiChunk): string {
  const parts = [
    chunk.pageTitle,
    chunk.headingPath.join(' > '),
    chunk.aliases.join('; '),
    chunk.text,
  ].filter(Boolean)
  return parts.join('\n').slice(0, MAX_EMBEDDING_TEXT_LENGTH)
}

function embeddingHash(model: string, chunk: WikiChunk): string {
  return createHash('sha256')
    .update(`${model}\n${chunk.id}\n${embeddingText(chunk)}`)
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function modelDirectoryIsComplete(directory: string): Promise<boolean> {
  const results = await Promise.all(
    REQUIRED_MODEL_FILES.map((fileName) => fileExists(join(directory, fileName))),
  )
  return results.every(Boolean)
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function downloadModelArchive(targetPath: string): Promise<void> {
  const response = await fetch(FASTEMBED_MODEL_URL, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Astra-Wiki-Bot/0.1' },
  })
  if (!response.ok || !response.body) {
    throw new Error(`Model download failed with HTTP ${response.status}.`)
  }

  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MODEL_ARCHIVE_BYTES) {
    throw new Error('The embedding model archive is larger than the configured safety limit.')
  }

  const temporaryPath = `${targetPath}.${process.pid}.download`
  const file = await open(temporaryPath, 'w')
  let written = 0
  let completed = false
  try {
    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      written += value.byteLength
      if (written > MAX_MODEL_ARCHIVE_BYTES) {
        await reader.cancel()
        throw new Error('The embedding model archive exceeded the configured safety limit.')
      }
      await file.write(value)
    }
    completed = true
  } finally {
    await file.close()
    if (!completed) await rm(temporaryPath, { force: true })
  }
  await rename(temporaryPath, targetPath)
}

async function ensureFastEmbedModel(cacheDirectory: string): Promise<void> {
  await mkdir(cacheDirectory, { recursive: true })
  const modelDirectory = join(cacheDirectory, FASTEMBED_MODEL_DIRECTORY)
  if (await modelDirectoryIsComplete(modelDirectory)) return

  const archivePath = join(cacheDirectory, FASTEMBED_MODEL_ARCHIVE)
  if (!await fileExists(archivePath)) await downloadModelArchive(archivePath)

  const archiveStats = await stat(archivePath)
  if (archiveStats.size <= 0 || archiveStats.size > MAX_MODEL_ARCHIVE_BYTES) {
    await rm(archivePath, { force: true })
    throw new Error('The embedding model archive has an invalid size.')
  }
  const archiveHash = await sha256File(archivePath)
  if (archiveHash !== FASTEMBED_MODEL_SHA256) {
    await rm(archivePath, { force: true })
    throw new Error('The embedding model archive failed its SHA-256 integrity check.')
  }

  const extractionDirectory = await mkdtemp(join(cacheDirectory, '.extract-'))
  try {
    await tar.x({
      file: archivePath,
      cwd: extractionDirectory,
      strict: true,
      preservePaths: false,
    })
    const extractedModelDirectory = join(extractionDirectory, FASTEMBED_MODEL_DIRECTORY)
    if (!await modelDirectoryIsComplete(extractedModelDirectory)) {
      throw new Error('The embedding model archive is missing required files.')
    }
    await rm(modelDirectory, { recursive: true, force: true })
    await rename(extractedModelDirectory, modelDirectory)
    await rm(archivePath, { force: true })
  } finally {
    await rm(extractionDirectory, { recursive: true, force: true })
  }
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

export class LocalEmbeddingModel {
  #embeddingPromise: Promise<FlagEmbeddingInstance> | null = null

  constructor(
    readonly model: string,
    private readonly cacheDirectory: string,
  ) {}

  #fastEmbedModel(): typeof EmbeddingModel.AllMiniLML6V2 {
    const normalized = this.model.trim().toLocaleLowerCase()
    if (
      normalized === 'sentence-transformers/all-minilm-l6-v2'
      || normalized === EmbeddingModel.AllMiniLML6V2.toLocaleLowerCase()
    ) return EmbeddingModel.AllMiniLML6V2
    throw new Error(
      `Unsupported embedding model ${this.model}. `
      + 'Use sentence-transformers/all-MiniLM-L6-v2.',
    )
  }

  async #embedding(): Promise<FlagEmbeddingInstance> {
    if (!this.#embeddingPromise) {
      this.#embeddingPromise = (async () => {
        await ensureFastEmbedModel(this.cacheDirectory)
        return FlagEmbedding.init({
          model: this.#fastEmbedModel(),
          cacheDir: this.cacheDirectory,
          executionProviders: [ExecutionProvider.CPU],
          showDownloadProgress: true,
        })
      })()
    }
    return this.#embeddingPromise
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    const embedding = await this.#embedding()
    const vectors: number[][] = []
    for await (const batch of embedding.passageEmbed(texts, DEFAULT_BATCH_SIZE)) {
      for (const rawVector of batch) {
        const vector = normalizedNumberArray(rawVector)
        if (!vector) throw new Error('The embedding model returned an invalid vector.')
        vectors.push(vector)
      }
    }
    if (vectors.length !== texts.length) {
      throw new Error('The embedding model returned an unexpected vector count.')
    }
    return vectors
  }

  async embedOne(text: string): Promise<number[]> {
    const embedding = await this.#embedding()
    const vector = normalizedNumberArray(await embedding.queryEmbed(text))
    if (!vector) throw new Error('The embedding model returned no query vector.')
    return vector
  }
}

export class LocalSemanticIndex implements SemanticSearcher {
  private constructor(
    private readonly embeddingModel: LocalEmbeddingModel,
    private readonly chunkVectors: ChunkVector[],
  ) {}

  static async build(options: {
    chunks: WikiChunk[]
    embeddingModel: LocalEmbeddingModel
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
      const vectors = await options.embeddingModel.embedMany(
        batch.map(({ chunk }) => embeddingText(chunk)),
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
    const queryVector = await this.embeddingModel.embedOne(query)
    return this.chunkVectors
      .map(({ chunk, vector }) => ({ chunk, similarity: dotProduct(queryVector, vector) }))
      .sort((left, right) => right.similarity - left.similarity || left.chunk.id.localeCompare(right.chunk.id))
      .slice(0, Math.max(0, limit))
  }
}
