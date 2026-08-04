import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type ChatInputCommandInteraction,
  type MessageContextMenuCommandInteraction,
} from 'discord.js'
import type { BotConfig } from '../config.js'
import type { WikiService } from '../app/wikiService.js'
import { WIKI_MESSAGE_COMMAND, WIKI_SLASH_COMMAND } from './commands.js'
import { renderWikiResponse } from './renderResponse.js'

async function runSearch(
  interaction: ChatInputCommandInteraction | MessageContextMenuCommandInteraction,
  service: WikiService,
  query: string,
): Promise<void> {
  if (!query.trim()) {
    await interaction.reply({
      content: 'That message has no searchable text.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    })
    return
  }

  await interaction.deferReply()
  try {
    const response = await service.search(query, 3)
    await interaction.editReply(renderWikiResponse(response))
  } catch (error) {
    console.error('Wiki search failed.', error)
    await interaction.editReply({
      content: 'The Astra Wiki index is temporarily unavailable. Please try again in a moment.',
      allowedMentions: { parse: [] },
    })
  }
}

export async function startDiscordBot(config: BotConfig, service: WikiService): Promise<Client> {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] })

  client.once(Events.ClientReady, (readyClient) => {
    console.info(`Discord connected as ${readyClient.user.tag}.`)
  })

  client.on(Events.InteractionCreate, (interaction) => {
    if (interaction.isChatInputCommand() && interaction.commandName === WIKI_SLASH_COMMAND) {
      const query = interaction.options.getString('question', true)
      void runSearch(interaction, service, query)
      return
    }

    if (interaction.isMessageContextMenuCommand() && interaction.commandName === WIKI_MESSAGE_COMMAND) {
      const messageText = [
        interaction.targetMessage.content,
        ...interaction.targetMessage.embeds.flatMap((embed) => [embed.title, embed.description]),
      ].filter((value): value is string => Boolean(value)).join('\n')
      void runSearch(interaction, service, messageText)
    }
  })

  await client.login(config.discordToken)
  return client
}
