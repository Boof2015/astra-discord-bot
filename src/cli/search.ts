import { createSearchEngine } from '../search/createEngine.js'
import { loadConfig, loadLocalEnvironment } from '../config.js'

loadLocalEnvironment()
const query = process.argv.slice(2).filter((argument) => argument !== '--semantic').join(' ').trim()
if (!query) {
  console.error('Usage: npm run search -- "your question" [--semantic]')
  process.exitCode = 1
} else {
  const config = loadConfig({ requireDiscord: false })
  const semanticEnabled = process.argv.includes('--semantic')
  const created = await createSearchEngine({
    productName: config.identity.productName,
    wikiDirectory: config.wikiDirectory,
    wikiBaseUrl: config.wikiBaseUrl,
    aliasesFile: config.aliasesFile,
    semanticEnabled,
    embeddingModel: config.embeddingModel,
    modelCacheDirectory: config.modelCacheDirectory,
    embeddingCacheFile: config.embeddingCacheFile,
  })
  const response = await created.engine.search(query, 5)
  console.info(`${response.confidence} confidence · ${created.chunkCount} indexed sections`)
  response.results.forEach((result, index) => {
    console.info(`${index + 1}. ${result.chunk.id}`)
    console.info(`   ${result.chunk.url}`)
    console.info(`   ${result.chunk.excerpt}`)
  })
}
