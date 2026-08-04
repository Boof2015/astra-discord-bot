import assert from 'node:assert/strict'
import test from 'node:test'
import { LexicalIndex } from '../src/search/lexical.js'
import type { WikiChunk } from '../src/wiki/types.js'

function chunk(overrides: Partial<WikiChunk> & Pick<WikiChunk, 'id' | 'heading' | 'text'>): WikiChunk {
  const pageSlug = overrides.id.split('#')[0] ?? overrides.id
  return {
    id: overrides.id,
    pageSlug,
    pageTitle: overrides.pageTitle ?? pageSlug.replace(/-/g, ' '),
    heading: overrides.heading,
    headingPath: overrides.headingPath ?? [overrides.heading],
    level: overrides.level ?? 2,
    anchor: overrides.anchor ?? overrides.id.split('#')[1] ?? null,
    text: overrides.text,
    excerpt: overrides.excerpt ?? overrides.text,
    url: overrides.url ?? `https://example.test/${overrides.id}`,
    sourcePath: overrides.sourcePath ?? `${pageSlug}.md`,
    contentHash: overrides.contentHash ?? overrides.id,
    aliases: overrides.aliases ?? [],
  }
}

test('exact aliases outrank incidental body mentions', () => {
  const target = chunk({
    id: 'Parallax#tune-speaker-timing',
    heading: 'Tune Speaker Timing',
    text: 'Correct fixed output latency after automatic synchronization.',
    aliases: ['synced but delayed', 'parallax echo'],
  })
  const incidental = chunk({
    id: 'Troubleshooting#playback',
    heading: 'Playback stutters',
    text: 'A delayed network can occasionally cause synchronized playback to stutter.',
  })
  const index = new LexicalIndex([incidental, target])

  assert.equal(index.search('synced but delayed')[0]?.chunk.id, target.id)
})

test('headings receive more weight than ordinary body text', () => {
  const headingMatch = chunk({
    id: 'Wiki#artist-images',
    heading: 'Artist Images',
    text: 'Folder scanning rules.',
  })
  const bodyMatch = chunk({
    id: 'Wiki#artwork',
    heading: 'Artwork',
    text: 'This paragraph briefly mentions artist images.',
  })
  const index = new LexicalIndex([bodyMatch, headingMatch])

  assert.equal(index.search('artist images')[0]?.chunk.id, headingMatch.id)
})
