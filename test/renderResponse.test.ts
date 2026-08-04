import assert from 'node:assert/strict'
import test from 'node:test'
import { ActionRowBuilder, ButtonBuilder, EmbedBuilder } from 'discord.js'
import { renderWikiResponse } from '../src/discord/renderResponse.js'
import type { RankedWikiResult, WikiSearchResponse } from '../src/search/types.js'
import type { WikiChunk } from '../src/wiki/types.js'

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
  }
}

function rendered(response: WikiSearchResponse): {
  content: string | undefined
  embed: ReturnType<EmbedBuilder['toJSON']>
  row: ReturnType<ActionRowBuilder<ButtonBuilder>['toJSON']>
} {
  const output = renderWikiResponse(response)
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

test('renders a compact, query-relevant result without medium-confidence clutter', () => {
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
  assert.equal(embed.footer, undefined)
  assert.equal(row.components.length, 1)
  assert.equal(content, 'I think this is the bit you’re after:')
  assert.equal('label' in row.components[0]! ? row.components[0].label : undefined, 'Read this section')
})

test('shows compact alternatives only for low-confidence results', () => {
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

  assert.equal(embed.fields?.[0]?.name, 'Other possible sections')
  assert.match(embed.fields?.[0]?.value ?? '', /Now Playing information/)
  assert.equal(row.components.length, 1)
  assert.equal(content, 'Not totally sure on this one, but this is my best lead:')
})

test('uses the same voice when no Wiki section matches', () => {
  const output = renderWikiResponse({
    query: 'mysterious thing',
    confidence: 'low',
    results: [],
  })

  assert.ok([
    'I couldn’t pin that one down.',
    'I checked under the couch. Nothing.',
    'The Wiki has no idea what you’re talking about. Neither do I.',
  ].includes(String(output.content)))
})
