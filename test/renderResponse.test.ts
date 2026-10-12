import assert from 'node:assert/strict'
import test from 'node:test'
import { ActionRowBuilder, ButtonBuilder, EmbedBuilder } from 'discord.js'
import { renderWikiResponse } from '../src/discord/renderResponse.js'
import type { BotIdentity } from '../src/config.js'
import type { RankedWikiResult, WikiSearchResponse } from '../src/search/types.js'
import type { WikiChunk } from '../src/wiki/types.js'

const ASTRA_IDENTITY: BotIdentity = {
  productName: 'Astra',
  adminCommandName: 'astra',
  wikiLabel: 'Astra Wiki',
  accentColor: 0x8b5cf6,
}

const PRISM_IDENTITY: BotIdentity = {
  productName: 'Prism',
  adminCommandName: 'prism',
  wikiLabel: 'Prism Wiki',
  accentColor: 0x22d3ee,
}

function rankedResult(overrides: Partial<WikiChunk> = {}): RankedWikiResult {
  const chunk: WikiChunk = {
    id: 'Audio-Output#format-changes',
    pageSlug: 'Audio-Output',
    pageTitle: 'Audio Output and Bit-Perfect Playback',
    heading: 'Format changes and device support',
    headingPath: ['Audio Output and Bit-Perfect Playback', 'Format changes and device support'],
    level: 2,
    anchor: 'format-changes',
    text: [
      'Exclusive playback requires a compatible output device.',
      'Astra changes the DAC sample rate automatically to match each track.',
      'This avoids unnecessary resampling during playback.',
      'A final unrelated sentence should not be included.',
    ].join(' '),
    excerpt: 'Exclusive playback requires a compatible output device.',
    url: 'https://example.test/wiki/Audio-Output#format-changes',
    sourcePath: 'Audio-Output.md',
    contentHash: 'audio-output',
    aliases: [],
    ...overrides,
  }
  return {
    chunk,
    score: 1,
    lexicalRank: 1,
    lexicalScore: 1,
    semanticRank: 1,
    semanticSimilarity: 0.8,
    exactBoost: 0,
    queryTokenCount: 3,
    matchedQueryTokenCount: 2,
    matchedMetadataTokenCount: 1,
  }
}

function rendered(response: WikiSearchResponse): {
  content: string | undefined
  embed: ReturnType<EmbedBuilder['toJSON']>
  row: ReturnType<ActionRowBuilder<ButtonBuilder>['toJSON']>
} {
  const output = renderWikiResponse(response, ASTRA_IDENTITY)
  const embed = output.embeds?.[0]
  const row = output.components?.[0]
  assert.ok(embed instanceof EmbedBuilder)
  assert.ok(row instanceof ActionRowBuilder)
  return {
    content: typeof output.content === 'string' ? output.content : undefined,
    embed: embed.toJSON(),
    row: row.toJSON(),
  }
}

test('renders a compact result with the next-best section as a button', () => {
  const primary = rankedResult()
  const alternative = rankedResult({
    id: 'Queue#now-playing',
    heading: 'Now Playing information',
    url: 'https://example.test/wiki/Queue#now-playing',
  })
  const { content, embed, row } = rendered({
    query: 'why is my sample rate weird',
    confidence: 'medium',
    results: [primary, alternative],
  })

  assert.equal(embed.title, 'Format changes and device support')
  assert.equal(embed.author?.name, 'Audio Output and Bit-Perfect Playback')
  assert.match(embed.description ?? '', /^Astra changes the DAC sample rate/)
  assert.ok((embed.description?.length ?? Infinity) <= 300)
  assert.equal(embed.fields, undefined)
  assert.equal(embed.footer?.text, '1 other possible match below.')
  assert.equal(row.components.length, 2)
  assert.equal(content, 'I think this is the bit you’re after:')
  assert.equal('label' in row.components[0]! ? row.components[0].label : undefined, 'Read this section')
  assert.equal(
    'label' in row.components[1]! ? row.components[1].label : undefined,
    'Audio Output and Bit-Perfect Playback',
  )
})

test('keeps low-confidence alternatives out of the embed', () => {
  const { content, embed, row } = rendered({
    query: 'something strange',
    confidence: 'low',
    results: [
      rankedResult(),
      rankedResult({
        id: 'Queue#now-playing',
        heading: 'Now Playing information',
        url: 'https://example.test/wiki/Queue#now-playing',
      }),
    ],
  })

  assert.equal(embed.fields, undefined)
  assert.equal(embed.footer?.text, '1 other possible match below.')
  assert.equal(row.components.length, 2)
  assert.equal(content, 'Not totally sure on this one, but this is my best lead:')
})

test('offers at most three total section buttons', () => {
  const { embed, row } = rendered({
    query: 'sample rate trouble',
    confidence: 'high',
    results: [
      rankedResult(),
      rankedResult({
        id: 'Pipeline#resampler',
        pageTitle: 'Audio Pipeline Shelf',
        heading: 'Resampler',
        url: 'https://example.test/wiki/Pipeline#resampler',
      }),
      rankedResult({
        id: 'Troubleshooting#playback',
        pageTitle: 'Troubleshooting',
        heading: 'Playback problems',
        url: 'https://example.test/wiki/Troubleshooting#playback',
      }),
      rankedResult({
        id: 'Queue#now-playing',
        pageTitle: 'Queue',
        heading: 'Now Playing',
        url: 'https://example.test/wiki/Queue#now-playing',
      }),
    ],
  })

  assert.equal(row.components.length, 3)
  assert.equal(embed.footer?.text, '2 other possible matches below.')
  assert.equal(
    'label' in row.components[1]! ? row.components[1].label : undefined,
    'Audio Pipeline Shelf',
  )
  assert.equal(
    'label' in row.components[2]! ? row.components[2].label : undefined,
    'Troubleshooting',
  )
})

test('uses the same voice when no Wiki section matches', () => {
  const output = renderWikiResponse({
    query: 'mysterious thing',
    confidence: 'low',
    results: [],
  }, ASTRA_IDENTITY)

  assert.ok([
    'I couldn’t pin that one down.',
    'I checked under the couch. Nothing.',
    'The Wiki has no idea what you’re talking about. Neither do I.',
  ].includes(String(output.content)))
})

test('uses the configured Wiki label and accent color', () => {
  const output = renderWikiResponse({
    query: 'how do I get started',
    confidence: 'high',
    results: [rankedResult({
      id: 'Home',
      pageSlug: 'Home',
      pageTitle: 'Prism User Guide',
      heading: 'Prism User Guide',
    })],
  }, PRISM_IDENTITY)
  const embed = output.embeds?.[0]

  assert.ok(embed instanceof EmbedBuilder)
  assert.equal(embed.toJSON().author?.name, 'Prism Wiki')
  assert.equal(embed.toJSON().color, 0x22d3ee)
})
