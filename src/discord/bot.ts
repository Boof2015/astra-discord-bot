import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Message,
  type MessageContextMenuCommandInteraction,
} from 'discord.js'
import type { BotConfig } from '../config.js'
import type { WikiService } from '../app/wikiService.js'
import { WIKI_MESSAGE_COMMAND, WIKI_SLASH_COMMAND } from './commands.js'
import { queryFromMention } from './mention.js'
import { renderWikiResponse } from './renderResponse.js'

async function runSearch(
  interaction: ChatInputCommandInteraction | MessageContextMenuCommandInteraction,
  service: WikiService,
  query: string,
): Promise<void> {
  if (!query.trim()) {
    await interaction.reply({
      content: 'That message isn’t giving me much to search.',
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
      content: 'I lost track of the Wiki for a second. Try that again in a moment.',
      allowedMentions: { parse: [] },
    })
  }
}

async function runMentionSearch(
  message: Message,
  service: WikiService,
  query: string,
): Promise<void> {
  if (!query) {
    await message.reply({
      content: 'You’ve got me — ask a question after the mention and I’ll look through the Wiki.',
      allowedMentions: { parse: [], repliedUser: false },
    })
    return
  }

  if ('sendTyping' in message.channel) {
    void message.channel.sendTyping().catch(() => undefined)
  }
  try {
    const response = await service.search(query, 3)
    const rendered = renderWikiResponse(response)
    await message.reply({
      ...(typeof rendered.content === 'string' ? { content: rendered.content } : {}),
      ...(rendered.embeds ? { embeds: rendered.embeds } : {}),
      ...(rendered.components ? { components: rendered.components } : {}),
      allowedMentions: { parse: [], repliedUser: false },
    })
  } catch (error) {
    console.error('Mentioned Wiki search failed.', error)
    await message.reply({
      content: 'I lost track of the Wiki for a second. Try that again in a moment.',
      allowedMentions: { parse: [], repliedUser: false },
    })
  }
}

export async function startDiscordBot(config: BotConfig, service: WikiService): Promise<Client> {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  })

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

  client.on(Events.MessageCreate, (message) => {
    if (message.author.bot || !client.user || !message.mentions.users.has(client.user.id)) return
    const query = queryFromMention(message.content, client.user.id)
    if (query === null) return
    void runMentionSearch(message, service, query)
  })

  await client.login(config.discordToken)
  return client
}
