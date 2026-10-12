import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type InteractionEditReplyOptions,
} from 'discord.js'
import type { BotIdentity } from '../config.js'
import type { RankedWikiResult, WikiSearchResponse } from '../search/types.js'
import { tokenize } from '../search/tokenize.js'
import { personalityLines } from './personality.js'

const SNIPPET_LIMIT = 300
const MAX_SNIPPET_SENTENCES = 3

const FIXED_RESULT_LEADS = {
  medium: 'I think this is the bit you’re after:',
  low: 'Not totally sure on this one, but this is my best lead:',
} as const

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

export function renderWikiResponse(
  response: WikiSearchResponse,
  identity: BotIdentity,
): InteractionEditReplyOptions {
  const primary = response.results[0]
  if (!primary) {
    return {
      content: personalityLines.pick('noResult'),
      allowedMentions: { parse: [] },
    }
  }

  const embed = new EmbedBuilder()
    .setColor(identity.accentColor)
    .setAuthor({
      name: primary.chunk.heading === primary.chunk.pageTitle
        ? identity.wikiLabel
        : shortLabel(primary.chunk.pageTitle, identity.wikiLabel),
    })
    .setTitle(shortLabel(primary.chunk.heading, identity.wikiLabel))
    .setURL(primary.chunk.url)
    .setDescription(relevantSnippet(primary, response.query))

  const primaryButton = new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setURL(primary.chunk.url)
    .setLabel('Read this section')
  const buttons = [primaryButton]
  const alternatives = response.results.slice(1, 3)
  if (alternatives.length > 0) {
    embed.setFooter({
      text: `${alternatives.length} other possible ${alternatives.length === 1 ? 'match' : 'matches'} below.`,
    })
  }
  alternatives.forEach((result, index) => {
    buttons.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setURL(result.chunk.url)
        .setLabel(shortLabel(result.chunk.pageTitle, `Other result ${index + 1}`)),
    )
  })

  return {
    content: response.confidence === 'high'
      ? personalityLines.pick('highResult')
      : FIXED_RESULT_LEADS[response.confidence],
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)],
    allowedMentions: { parse: [] },
  }
}
