import { resolve } from 'node:path'
import { loadConfig, loadLocalEnvironment } from '../config.js'
import { loadEvaluationQueries } from '../evaluation/cases.js'
import { createSearchEngine } from '../search/createEngine.js'

loadLocalEnvironment()
const config = loadConfig({ requireDiscord: false })
const semanticEnabled = process.argv.includes('--semantic')
const verbose = process.argv.includes('--verbose')
const summaryOnly = process.argv.includes('--summary-only')
const evaluationPath = resolve(
  process.env.EVALUATION_PATH?.trim()
    || process.env.EVALUATION_FILE?.trim()
    || './test/queries',
)
const queries = await loadEvaluationQueries(evaluationPath)
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
let pageTopOneHits = 0
let pageTopThreeHits = 0
let noResultHits = 0
let noResultQueries = 0
const passingIntents = new Map<string, boolean>()
const suites = new Map<string, {
  variants: number
  topOne: number
  topThree: number
  intents: Map<string, boolean>
}>()
for (const evaluation of queries) {
  if (!passingIntents.has(evaluation.intent)) passingIntents.set(evaluation.intent, true)
  const suiteName = evaluation.intent.split(':', 1)[0] ?? evaluation.source
  const suite = suites.get(suiteName) ?? {
    variants: 0,
    topOne: 0,
    topThree: 0,
    intents: new Map<string, boolean>(),
  }
  suites.set(suiteName, suite)
  suite.variants += 1
  if (!suite.intents.has(evaluation.intent)) suite.intents.set(evaluation.intent, true)
  const response = await created.engine.search(evaluation.query, 3)
  const ids = response.results.map((result) => result.chunk.id)
  const expectsNoResult = evaluation.expected.length === 0
  if (expectsNoResult) noResultQueries += 1
  const topOneMatch = expectsNoResult
    ? ids.length === 0
    : ids[0] ? evaluation.expected.includes(ids[0]) : false
  const topThreeMatch = expectsNoResult
    ? ids.length === 0
    : ids.some((id) => evaluation.expected.includes(id))
  const expectedPages = new Set(evaluation.expected.map((id) => id.split('#', 1)[0]))
  const receivedPages = ids.map((id) => id.split('#', 1)[0])
  const pageTopOneMatch = expectsNoResult
    ? ids.length === 0
    : receivedPages[0] ? expectedPages.has(receivedPages[0]) : false
  const pageTopThreeMatch = expectsNoResult
    ? ids.length === 0
    : receivedPages.some((page) => expectedPages.has(page))
  if (topOneMatch) topOneHits += 1
  if (topThreeMatch) topThreeHits += 1
  if (pageTopOneMatch) pageTopOneHits += 1
  if (pageTopThreeMatch) pageTopThreeHits += 1
  if (expectsNoResult && topOneMatch) noResultHits += 1
  if (topOneMatch) suite.topOne += 1
  if (topThreeMatch) suite.topThree += 1
  if (!topOneMatch) passingIntents.set(evaluation.intent, false)
  if (!topOneMatch) suite.intents.set(evaluation.intent, false)

  const marker = topOneMatch ? '✓' : topThreeMatch ? '~' : '✗'
  if (!summaryOnly && (verbose || !topOneMatch)) {
    console.info(`${marker} [${evaluation.intent}] ${evaluation.query}`)
  }
  if (!summaryOnly && !topOneMatch) {
    console.info(`  expected: ${evaluation.expected.join(' OR ') || '(no result)'}`)
    console.info(`  received: ${ids.join(', ') || '(none)'}`)
  }
}

const fullyPassingIntents = [...passingIntents.values()].filter(Boolean).length
console.info('')
for (const [name, suite] of suites) {
  const passingSuiteIntents = [...suite.intents.values()].filter(Boolean).length
  console.info(
    `${name}: top 1 ${suite.topOne}/${suite.variants}, top 3 ${suite.topThree}/${suite.variants}, intents ${passingSuiteIntents}/${suite.intents.size}`,
  )
}
console.info('')
console.info(`Variants at top 1: ${topOneHits}/${queries.length}`)
console.info(`Variants in top 3: ${topThreeHits}/${queries.length}`)
console.info(`Correct page at top 1: ${pageTopOneHits}/${queries.length}`)
console.info(`Correct page in top 3: ${pageTopThreeHits}/${queries.length}`)
console.info(`Intents fully passing: ${fullyPassingIntents}/${passingIntents.size}`)
console.info(`Mode: ${created.semanticEnabled ? 'hybrid' : 'lexical-only'}`)

function minimumRate(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a number from 0 through 1.`)
  }
  return value
}

const minimumTopOne = minimumRate(
  'EVALUATION_MIN_TOP_ONE',
  created.semanticEnabled ? 0.6 : 0.4,
)
const minimumTopThree = minimumRate(
  'EVALUATION_MIN_TOP_THREE',
  created.semanticEnabled ? 0.8 : 0.55,
)
const minimumPageTopOne = minimumRate(
  'EVALUATION_MIN_PAGE_TOP_ONE',
  created.semanticEnabled ? 0.82 : 0.67,
)
const minimumPageTopThree = minimumRate(
  'EVALUATION_MIN_PAGE_TOP_THREE',
  created.semanticEnabled ? 0.94 : 0.79,
)
const minimumNoResult = minimumRate(
  'EVALUATION_MIN_NO_RESULT',
  created.semanticEnabled ? 1 : 0.9,
)
const topOneRate = topOneHits / queries.length
const topThreeRate = topThreeHits / queries.length
const pageTopOneRate = pageTopOneHits / queries.length
const pageTopThreeRate = pageTopThreeHits / queries.length
const noResultRate = noResultQueries > 0 ? noResultHits / noResultQueries : 1
const passed = topOneRate >= minimumTopOne
  && topThreeRate >= minimumTopThree
  && pageTopOneRate >= minimumPageTopOne
  && pageTopThreeRate >= minimumPageTopThree
  && noResultRate >= minimumNoResult
console.info(
  `Regression floor: section ${minimumTopOne}/${minimumTopThree}, page ${minimumPageTopOne}/${minimumPageTopThree}, no-result ${minimumNoResult} — ${passed ? 'pass' : 'FAIL'}`,
)
if (!passed) process.exitCode = 1
