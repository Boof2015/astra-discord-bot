import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type InteractionEditReplyOptions,
} from 'discord.js'
import type { RankedWikiResult, WikiSearchResponse } from '../search/types.js'

const ASTRA_COLOR = 0x8b5cf6

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

export function renderWikiResponse(response: WikiSearchResponse): InteractionEditReplyOptions {
  const primary = response.results[0]
  if (!primary) {
    return {
      content: 'I could not find a relevant Astra Wiki section. Try naming the feature or the symptom more specifically.',
      allowedMentions: { parse: [] },
    }
  }

  const confidenceLead = response.confidence === 'high'
    ? 'This is the closest section in the Astra user guide.'
    : response.confidence === 'medium'
      ? 'This looks relevant. I included other possible matches below.'
      : 'I am not confident enough to choose one section, but these are the closest matches.'

  const embed = new EmbedBuilder()
    .setColor(ASTRA_COLOR)
    .setTitle(shortLabel(resultTitle(primary), 'Astra Wiki'))
    .setURL(primary.chunk.url)
    .setDescription(`${confidenceLead}\n\n${primary.chunk.excerpt}`)
    .setFooter({ text: `Astra Wiki · ${response.confidence} confidence` })

  const alternatives = response.results.slice(1)
  if (alternatives.length > 0) {
    embed.addFields({
      name: 'Other possible matches',
      value: alternatives
        .map((result) => `• [${resultTitle(result)}](${result.chunk.url})`)
        .join('\n'),
    })
  }

  const buttons = response.results.slice(0, 3).map((result, index) => new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setURL(result.chunk.url)
    .setLabel(index === 0 ? 'Open Wiki Section' : shortLabel(result.chunk.heading, `Alternative ${index}`)))

  return {
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)],
    allowedMentions: { parse: [] },
  }
}
