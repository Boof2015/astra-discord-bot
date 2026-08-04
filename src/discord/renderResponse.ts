import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type InteractionEditReplyOptions,
} from 'discord.js'
import type { RankedWikiResult, WikiSearchResponse } from '../search/types.js'
import { tokenize } from '../search/tokenize.js'
import { personalityLines } from './personality.js'

const ASTRA_COLOR = 0x8b5cf6
const SNIPPET_LIMIT = 300
const MAX_SNIPPET_SENTENCES = 3

const FIXED_RESULT_LEADS = {
  medium: 'I think this is the bit you’re after:',
  low: 'Not totally sure on this one, but this is my best lead:',
} as const

function resultTitle(result: RankedWikiResult): string {
  return result.chunk.heading === result.chunk.pageTitle
    ? result.chunk.pageTitle
    : `${result.chunk.pageTitle} › ${result.chunk.heading}`
}

function shortLabel(value: string, fallback: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return fallback
  return compact.length <= 70 ? compact : `${compact.slice(0, 67).trimEnd()}…`
}

function sentencesFrom(value: string): string[] {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .match(/[^.!?]+(?:[.!?]+|$)/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) ?? []
}

function truncateSnippet(value: string): string {
  if (value.length <= SNIPPET_LIMIT) return value
  const candidate = value.slice(0, SNIPPET_LIMIT)
  const wordEnd = candidate.lastIndexOf(' ')
  return `${candidate.slice(0, wordEnd > 0 ? wordEnd : SNIPPET_LIMIT).trimEnd()}…`
}

function relevantSnippet(result: RankedWikiResult, query: string): string {
  const sentences = sentencesFrom(result.chunk.text)
  if (sentences.length === 0) return truncateSnippet(result.chunk.excerpt)

  const queryTokens = new Set(tokenize(query))
  let bestIndex = 0
  let bestScore = 0
  sentences.forEach((sentence, index) => {
    const sentenceTokens = new Set(tokenize(sentence))
    const score = [...queryTokens].filter((token) => sentenceTokens.has(token)).length
    if (score > bestScore) {
      bestIndex = index
      bestScore = score
    }
  })

  const selected: string[] = []
  for (
    let index = bestIndex;
    index < sentences.length && selected.length < MAX_SNIPPET_SENTENCES;
    index += 1
  ) {
    const sentence = sentences[index]
    if (!sentence) continue
    const candidate = [...selected, sentence].join(' ')
    if (candidate.length > SNIPPET_LIMIT && selected.length > 0) break
    selected.push(sentence)
    if (candidate.length >= SNIPPET_LIMIT) break
  }

  return truncateSnippet(selected.join(' '))
}

export function renderWikiResponse(response: WikiSearchResponse): InteractionEditReplyOptions {
  const primary = response.results[0]
  if (!primary) {
    return {
      content: personalityLines.pick('noResult'),
      allowedMentions: { parse: [] },
    }
  }

  const embed = new EmbedBuilder()
    .setColor(ASTRA_COLOR)
    .setAuthor({
      name: primary.chunk.heading === primary.chunk.pageTitle
        ? 'Astra Wiki'
        : shortLabel(primary.chunk.pageTitle, 'Astra Wiki'),
    })
    .setTitle(shortLabel(primary.chunk.heading, 'Astra Wiki'))
    .setURL(primary.chunk.url)
    .setDescription(relevantSnippet(primary, response.query))

  const alternatives = response.confidence === 'low' ? response.results.slice(1) : []
  if (alternatives.length > 0) {
    embed.addFields({
      name: 'Other possible sections',
      value: alternatives
        .map((result) => `• [${shortLabel(resultTitle(result), 'Wiki section')}](${result.chunk.url})`)
        .join('\n'),
    })
  }

  const button = new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setURL(primary.chunk.url)
    .setLabel('Read this section')

  return {
    content: response.confidence === 'high'
      ? personalityLines.pick('highResult')
      : FIXED_RESULT_LEADS[response.confidence],
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
    allowedMentions: { parse: [] },
  }
}
