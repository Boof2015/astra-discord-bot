import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { parse } from 'yaml'

export interface EvaluationQuery {
  intent: string
  query: string
  expected: string[]
  source: string
}

function expectedIds(value: unknown, context: string): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return [...new Set(value.map((entry) => entry.trim()).filter(Boolean))]
  }
  throw new Error(`${context} expected must be a section ID or a list of section IDs.`)
}

function parseGroupedIntents(value: { intents: unknown }, source: string): EvaluationQuery[] {
  if (!Array.isArray(value.intents)) throw new Error(`${source} intents must be a list.`)
  const queries: EvaluationQuery[] = []

  value.intents.forEach((entry, index) => {
    const context = `${source} intent ${index + 1}`
    if (!entry || typeof entry !== 'object') throw new Error(`${context} must be a mapping.`)
    if (!('name' in entry) || typeof entry.name !== 'string' || !entry.name.trim()) {
      throw new Error(`${context} must have a name.`)
    }
    if (!('expected' in entry)) throw new Error(`${context} must have expected results.`)
    if (!('variants' in entry) || !Array.isArray(entry.variants) || entry.variants.length === 0) {
      throw new Error(`${context} must have at least one query variant.`)
    }
    const variants: unknown[] = entry.variants
    if (!variants.every((variant) => typeof variant === 'string' && variant.trim())) {
      throw new Error(`${context} variants must be non-empty strings.`)
    }

    const intentName = entry.name.trim()
    const intent = `${basename(source, extname(source))}:${intentName}`
    const expected = expectedIds(entry.expected, context)
    for (const variant of variants as string[]) {
      queries.push({
        intent,
        query: variant.trim(),
        expected,
        source,
      })
    }
  })

  return queries
}

function parseLegacyQueries(value: { queries: unknown }, source: string): EvaluationQuery[] {
  if (!Array.isArray(value.queries)) throw new Error(`${source} queries must be a list.`)
  return value.queries.map((entry, index) => {
    const context = `${source} query ${index + 1}`
    if (!entry || typeof entry !== 'object' || !('query' in entry) || !('expected' in entry)) {
      throw new Error(`${context} is invalid.`)
    }
    if (typeof entry.query !== 'string' || !entry.query.trim()) {
      throw new Error(`${context} must contain a non-empty query.`)
    }
    return {
      intent: `${basename(source, extname(source))}:legacy-${index + 1}`,
      query: entry.query.trim(),
      expected: expectedIds(entry.expected, context),
      source,
    }
  })
}

export function parseEvaluationSource(value: unknown, source: string): EvaluationQuery[] {
  if (!value || typeof value !== 'object') {
    throw new Error(`${source} must contain an intents or queries mapping.`)
  }
  if ('intents' in value) return parseGroupedIntents(value as { intents: unknown }, source)
  if ('queries' in value) return parseLegacyQueries(value as { queries: unknown }, source)
  throw new Error(`${source} must contain an intents or queries mapping.`)
}

async function evaluationFiles(path: string): Promise<string[]> {
  const pathStat = await stat(path)
  if (pathStat.isFile()) return [path]
  if (!pathStat.isDirectory()) throw new Error(`Evaluation path is not a file or directory: ${path}`)
  return (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && ['.yml', '.yaml'].includes(extname(entry.name)))
    .map((entry) => join(path, entry.name))
    .sort((left, right) => left.localeCompare(right))
}

export async function loadEvaluationQueries(path: string): Promise<EvaluationQuery[]> {
  const files = await evaluationFiles(path)
  if (files.length === 0) throw new Error(`No YAML evaluation files found at ${path}.`)

  const queries: EvaluationQuery[] = []
  const seenIntents = new Set<string>()
  for (const file of files) {
    const parsed = parseEvaluationSource(parse(await readFile(file, 'utf8')), file)
    for (const query of parsed) {
      queries.push(query)
      seenIntents.add(query.intent)
    }
  }
  if (queries.length === 0 || seenIntents.size === 0) {
    throw new Error(`No evaluation queries found at ${path}.`)
  }
  return queries
}
