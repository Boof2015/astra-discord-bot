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

test('an exact page title favors the page overview', () => {
  const overview = chunk({
    id: 'Parallax',
    heading: 'Parallax',
    level: 1,
    text: 'Synchronized playback across computers.',
  })
  const child = chunk({
    id: 'Parallax#enable-parallax',
    pageTitle: 'Parallax',
    heading: 'Enable Parallax',
    headingPath: ['Parallax', 'Enable Parallax'],
    text: 'Turn on the network speaker feature.',
  })
  const index = new LexicalIndex([child, overview])

  const hit = index.search('Parallax')[0]
  assert.equal(hit?.chunk.id, overview.id)
  assert.ok((hit?.exactBoost ?? 0) > 0)
})

test('an exact section heading receives a phrase boost', () => {
  const target = chunk({
    id: 'Equalizer#q',
    pageTitle: 'Equalizer',
    heading: 'Q',
    headingPath: ['Equalizer', 'Band controls', 'Q'],
    text: 'Controls filter width.',
  })
  const incidental = chunk({
    id: 'Equalizer#bands',
    pageTitle: 'Equalizer',
    heading: 'Band controls',
    text: 'Adjust frequency, gain, and Q.',
  })
  const index = new LexicalIndex([incidental, target])

  assert.equal(index.search('Q')[0]?.chunk.id, target.id)
})

test('common question wrappers still allow an exact page-title match', () => {
  const root = chunk({
    id: 'Equalizer',
    heading: 'Equalizer',
    text: 'Shape the sound with parametric bands.',
  })
  const setup = chunk({
    id: 'Equalizer#open-and-enable-the-eq',
    heading: 'Open and enable the EQ',
    text: 'Open Settings and turn the equalizer on.',
  })
  const hits = new LexicalIndex([setup, root]).search('where is the equalizer')

  assert.equal(hits[0]?.chunk.id, root.id)
  assert.ok((hits[0]?.exactBoost ?? 0) >= 10)
})

test('common question wrappers still allow an exact alias match', () => {
  const exclusive = chunk({
    id: 'Audio#exclusive',
    heading: 'Bit-perfect exclusive',
    text: 'Send audio directly to the device.',
    aliases: ['enable exclusive mode'],
  })
  const other = chunk({
    id: 'Audio#device',
    heading: 'Choose a device',
    text: 'Select an output device.',
  })
  const hits = new LexicalIndex([other, exclusive]).search('how do I enable exclusive mode')

  assert.equal(hits[0]?.chunk.id, exclusive.id)
  assert.equal(hits[0]?.exactBoost, 14)
})

test('question-wrapper matching does not turn a longer symptom into a page-title match', () => {
  const root = chunk({
    id: 'Equalizer',
    heading: 'Equalizer',
    text: 'Shape the sound with parametric bands.',
  })
  const disabled = chunk({
    id: 'Audio#disabled',
    heading: 'Processing is disabled',
    text: 'Exclusive mode disables the equalizer.',
  })
  const hits = new LexicalIndex([root, disabled]).search(
    'why is the equalizer disabled in exclusive mode',
  )

  assert.equal(hits.find((hit) => hit.chunk.id === root.id)?.exactBoost, 0)
})

test('product suffix matching uses the configured product name', () => {
  const profile = chunk({
    id: 'Profiles',
    heading: 'Profiles',
    text: 'Save and restore the current rack layout.',
  })
  const index = new LexicalIndex([profile], 'Prism')

  const prismHit = index.search('where are profiles in Prism')[0]
  const astraHit = index.search('where are profiles in Astra')[0]

  assert.ok((prismHit?.exactBoost ?? 0) >= 10)
  assert.equal(astraHit?.exactBoost, 0)
})

test('direct modal questions still allow an exact alias match', () => {
  const plugins = chunk({
    id: 'DAW-Plugins',
    heading: 'DAW Plugins',
    text: 'Load Prism analyzers in an audio workstation.',
    aliases: ['use a Prism analyzer in my DAW'],
  })
  const index = new LexicalIndex([plugins], 'Prism')

  assert.equal(
    index.search('can I use a Prism analyzer in my DAW')[0]?.exactBoost,
    14,
  )
})
