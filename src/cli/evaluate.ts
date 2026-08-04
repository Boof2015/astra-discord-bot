import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { loadConfig, loadLocalEnvironment } from '../config.js'
import { createSearchEngine } from '../search/createEngine.js'

interface EvaluationQuery {
  query: string
  expected: string[]
}

function parseEvaluationQueries(value: unknown): EvaluationQuery[] {
  if (!value || typeof value !== 'object' || !('queries' in value)) {
    throw new Error('Evaluation file must contain a queries list.')
  }
  const queries = (value as { queries: unknown }).queries
  if (!Array.isArray(queries)) throw new Error('Evaluation queries must be a list.')

  return queries.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || !('query' in entry) || !('expected' in entry)) {
      throw new Error(`Evaluation query ${index + 1} is invalid.`)
    }
    const query = (entry as { query: unknown }).query
    const expectedValue = (entry as { expected: unknown }).expected
    const expected = typeof expectedValue === 'string'
      ? [expectedValue]
      : Array.isArray(expectedValue) && expectedValue.every((item) => typeof item === 'string')
        ? expectedValue
        : null
    if (typeof query !== 'string' || !query.trim() || !expected || expected.length === 0) {
      throw new Error(`Evaluation query ${index + 1} is invalid.`)
    }
    return { query, expected }
  })
}

loadLocalEnvironment()
const config = loadConfig({ requireDiscord: false })
const semanticEnabled = process.argv.includes('--semantic')
const evaluationPath = resolve(process.env.EVALUATION_FILE?.trim() || './test/queries.yml')
const queries = parseEvaluationQueries(parse(await readFile(evaluationPath, 'utf8')))
const created = await createSearchEngine({
  wikiDirectory: config.wikiDirectory,
  wikiBaseUrl: config.wikiBaseUrl,
  aliasesFile: config.aliasesFile,
  semanticEnabled,
  embeddingModel: config.embeddingModel,
  modelCacheDirectory: config.modelCacheDirectory,
  embeddingCacheFile: config.embeddingCacheFile,
})

let topOneHits = 0
let topThreeHits = 0
for (const evaluation of queries) {
  const response = await created.engine.search(evaluation.query, 3)
  const ids = response.results.map((result) => result.chunk.id)
  const topOneMatch = ids[0] ? evaluation.expected.includes(ids[0]) : false
  const topThreeMatch = ids.some((id) => evaluation.expected.includes(id))
  if (topOneMatch) topOneHits += 1
  if (topThreeMatch) topThreeHits += 1

  const marker = topOneMatch ? '✓' : topThreeMatch ? '~' : '✗'
  console.info(`${marker} ${evaluation.query}`)
  if (!topOneMatch) {
    console.info(`  expected: ${evaluation.expected.join(' OR ')}`)
    console.info(`  received: ${ids.join(', ') || '(none)'}`)
  }
}

console.info('')
console.info(`Top 1: ${topOneHits}/${queries.length}`)
console.info(`Top 3: ${topThreeHits}/${queries.length}`)
console.info(`Mode: ${created.semanticEnabled ? 'hybrid' : 'lexical-only'}`)
if (topOneHits !== queries.length) process.exitCode = 1
