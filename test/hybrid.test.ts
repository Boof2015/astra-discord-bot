import assert from 'node:assert/strict'
import test from 'node:test'
import { WikiSearchEngine } from '../src/search/hybrid.js'
import { LexicalIndex } from '../src/search/lexical.js'
import type { SemanticHit, SemanticSearcher } from '../src/search/types.js'
import type { WikiChunk } from '../src/wiki/types.js'

function chunk(id: string, heading: string, text: string, aliases: string[] = []): WikiChunk {
  const [pageSlug = id, anchor] = id.split('#')
  return {
    id,
    pageSlug,
    pageTitle: pageSlug,
    heading,
    headingPath: [pageSlug, heading],
    level: 2,
    anchor: anchor ?? null,
    text,
    excerpt: text,
    url: `https://example.test/${id}`,
    sourcePath: `${pageSlug}.md`,
    contentHash: id,
    aliases,
  }
}

class FixedSemanticSearch implements SemanticSearcher {
  constructor(private readonly hits: SemanticHit[]) {}

  async search(_query: string, limit: number): Promise<SemanticHit[]> {
    return this.hits.slice(0, limit)
  }
}

test('an exact user-facing alias remains first when semantic ranking disagrees', async () => {
  const timing = chunk(
    'Parallax#timing',
    'Tune speaker timing',
    'Adjust trim for fixed speaker latency.',
    ['parallax echo'],
  )
  const unrelated = chunk('Audio#echo', 'Echo effects', 'Add an echo to playback.')
  const engine = new WikiSearchEngine(
    new LexicalIndex([timing, unrelated]),
    new FixedSemanticSearch([
      { chunk: unrelated, similarity: 0.9 },
      { chunk: timing, similarity: 0.8 },
    ]),
  )

  const response = await engine.search('parallax echo')

  assert.equal(response.results[0]?.chunk.id, timing.id)
  assert.equal(response.confidence, 'high')
})

test('semantic-only matches are returned when lexical search has no match', async () => {
  const result = chunk('Lyrics#offset', 'Correct lyric timing', 'Move timed lyrics earlier or later.')
  const engine = new WikiSearchEngine(
    new LexicalIndex([result]),
    new FixedSemanticSearch([{ chunk: result, similarity: 0.9 }]),
  )

  const response = await engine.search('the words are ahead of the singer')

  assert.equal(response.results[0]?.chunk.id, result.id)
  assert.equal(response.results[0]?.lexicalRank, null)
  assert.equal(response.results[0]?.semanticRank, 1)
})

test('abstains when an unrelated word has only a weak semantic match', async () => {
  const result = chunk(
    'Experimental#activity-indicator',
    'Activity indicator',
    'Shows whether Astra is playing or scanning.',
  )
  const engine = new WikiSearchEngine(
    new LexicalIndex([result]),
    new FixedSemanticSearch([{ chunk: result, similarity: 0.64 }]),
  )

  const response = await engine.search('bread')

  assert.equal(response.confidence, 'low')
  assert.deepEqual(response.results, [])
})
