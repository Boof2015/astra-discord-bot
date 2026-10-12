import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Message,
  type MessageContextMenuCommandInteraction,
} from 'discord.js'
import type { MaintenanceMode, MaintenanceStatus } from '../app/maintenanceMode.js'
import type { BotConfig, BotIdentity } from '../config.js'
import type { WikiService } from '../app/wikiService.js'
import type { RankedWikiResult } from '../search/types.js'
import { WIKI_SLASH_COMMAND, wikiMessageCommandName } from './commands.js'
import { queryFromMention } from './mention.js'
import { personalityLines } from './personality.js'
import { renderWikiResponse } from './renderResponse.js'

function discordTimestamp(value: Date, style: 'f' | 'R' = 'f'): string {
  return `<t:${Math.floor(value.getTime() / 1_000)}:${style}>`
}

function maintenanceMessage(status: MaintenanceStatus, identity: BotIdentity): string {
  let message = `${identity.productName} Bot is taking a quick maintenance break.`
  if (status.reason) message += `\nReason: ${status.reason}`
  message += status.resumeAt
    ? ` I’ll resume automatically ${discordTimestamp(status.resumeAt, 'R')}.`
    : ' Try again shortly.'
  return message
}

function formatScore(value: number | null): string {
  return value === null ? '—' : value.toFixed(3)
}

function resultPath(result: RankedWikiResult): string {
  if (result.exactBoost >= 10) return 'exact override'
  if (result.semanticRank !== null) return 'semantic'
  return 'lexical fallback'
}

async function runAdminCommand(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  service: WikiService,
  maintenance: MaintenanceMode,
  startedAt: Date,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: `You need **Manage Server** to use ${config.identity.productName}’s admin commands.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    })
    return
  }

  const subcommand = interaction.options.getSubcommand()
  try {
    if (subcommand === 'status') {
      const botStatus = await maintenance.status()
      const wikiStatus = service.status()
      const lines = [
        `**Public searches:** ${botStatus.paused ? 'Paused' : 'Active'}`,
        `**Search engine:** ${wikiStatus.semanticEnabled ? 'EmbeddingGemma + lexical overrides' : 'Lexical fallback only'}`,
        `**Configured model:** \`${config.embeddingModel}\``,
        `**Wiki index:** ${wikiStatus.chunkCount} sections at \`${wikiStatus.commit?.slice(0, 12) ?? 'unknown'}\``,
        `**Last refresh:** ${wikiStatus.refreshedAt ? discordTimestamp(wikiStatus.refreshedAt, 'R') : 'Not yet'}`,
        `**Bot started:** ${discordTimestamp(startedAt, 'R')}`,
      ]
      if (botStatus.paused) {
        if (botStatus.pausedBy) lines.push(`**Paused by:** <@${botStatus.pausedBy}>`)
        if (botStatus.pausedAt) lines.push(`**Paused:** ${discordTimestamp(botStatus.pausedAt, 'R')}`)
        if (botStatus.reason) lines.push(`**Reason:** ${botStatus.reason}`)
        if (botStatus.resumeAt) {
          lines.push(`**Automatic resume:** ${discordTimestamp(botStatus.resumeAt, 'R')}`)
        }
      }
      await interaction.reply({
        content: lines.join('\n'),
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      })
      return
    }

    if (subcommand === 'pause') {
      const durationMinutes = interaction.options.getInteger('minutes')
      const status = await maintenance.pause({
        pausedBy: interaction.user.id,
        reason: interaction.options.getString('reason'),
        durationMinutes,
      })
      const automaticResume = status.resumeAt
        ? ` I’ll resume automatically ${discordTimestamp(status.resumeAt, 'R')}.`
        : ''
      console.info(`${config.identity.productName} public Wiki searches paused by ${interaction.user.tag}.`)
      await interaction.reply({
        content: `${config.identity.wikiLabel} searches are paused.${automaticResume}`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      })
      return
    }

    if (subcommand === 'resume') {
      const wasPaused = await maintenance.resume()
      if (wasPaused) {
        console.info(`${config.identity.productName} public Wiki searches resumed by ${interaction.user.tag}.`)
      }
      await interaction.reply({
        content: wasPaused
          ? `${config.identity.wikiLabel} searches are active again.`
          : `${config.identity.wikiLabel} searches were already active.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      })
      return
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral })
    if (subcommand === 'refresh') {
      const before = service.status()
      await service.refresh(true)
      const after = service.status()
      const commitChanged = before.commit !== after.commit
      await interaction.editReply({
        content: [
          `Wiki refresh complete${commitChanged ? ' with new content' : ''}.`,
          `${after.chunkCount} sections · ${after.semanticEnabled ? 'EmbeddingGemma + lexical overrides' : 'lexical fallback only'} · \`${after.commit?.slice(0, 12) ?? 'unknown'}\``,
        ].join('\n'),
        allowedMentions: { parse: [] },
      })
      return
    }

    if (subcommand === 'inspect') {
      const query = interaction.options.getString('question', true)
      const response = await service.search(query, 3)
      const lines = [
        `**Confidence:** ${response.confidence}`,
        `**Query:** ${query}`,
      ]
      if (response.results.length === 0) {
        lines.push('', 'No result passed the evidence gate.')
      } else {
        response.results.forEach((result, index) => {
          lines.push(
            '',
            `**${index + 1}. [${result.chunk.pageTitle} › ${result.chunk.heading}](${result.chunk.url})**`,
            `\`${result.chunk.id}\``,
            `route: ${resultPath(result)} · score: ${result.score.toFixed(3)} · semantic: ${formatScore(result.semanticSimilarity)} (#${result.semanticRank ?? '—'}) · lexical: ${formatScore(result.lexicalScore)} (#${result.lexicalRank ?? '—'}) · exact: ${result.exactBoost}`,
          )
        })
      }
      await interaction.editReply({
        content: lines.join('\n'),
        allowedMentions: { parse: [] },
      })
      return
    }

    await interaction.editReply({
      content: `Unknown ${config.identity.productName} admin command.`,
      allowedMentions: { parse: [] },
    })
  } catch (error) {
    console.error(`${config.identity.productName} admin command ${subcommand} failed.`, error)
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({
        content: 'That admin operation failed. Check the bot logs for details.',
        allowedMentions: { parse: [] },
      })
    } else {
      await interaction.reply({
        content: 'That admin operation failed. Check the bot logs for details.',
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      })
    }
  }
}

async function runSearch(
  interaction: ChatInputCommandInteraction | MessageContextMenuCommandInteraction,
  identity: BotIdentity,
  service: WikiService,
  maintenance: MaintenanceMode,
  query: string,
): Promise<void> {
  const maintenanceStatus = await maintenance.status()
  if (maintenanceStatus.paused) {
    await interaction.reply({
      content: maintenanceMessage(maintenanceStatus, identity),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    })
    return
  }
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
    await interaction.editReply(renderWikiResponse(response, identity))
  } catch (error) {
    console.error(`${identity.wikiLabel} search failed.`, error)
    await interaction.editReply({
      content: personalityLines.pick('error'),
      allowedMentions: { parse: [] },
    })
  }
}

async function runMentionSearch(
  message: Message,
  identity: BotIdentity,
  service: WikiService,
  maintenance: MaintenanceMode,
  query: string,
): Promise<void> {
  const maintenanceStatus = await maintenance.status()
  if (maintenanceStatus.paused) {
    await message.reply({
      content: maintenanceMessage(maintenanceStatus, identity),
      allowedMentions: { parse: [], repliedUser: false },
    })
    return
  }

  if (!query) {
    await message.reply({
      content: personalityLines.pickForProduct('bareMention', identity.productName),
      allowedMentions: { parse: [], repliedUser: false },
    })
    return
  }

  if ('sendTyping' in message.channel) {
    void message.channel.sendTyping().catch(() => undefined)
  }
  try {
    const response = await service.search(query, 3)
    const rendered = renderWikiResponse(response, identity)
    await message.reply({
      ...(typeof rendered.content === 'string' ? { content: rendered.content } : {}),
      ...(rendered.embeds ? { embeds: rendered.embeds } : {}),
      ...(rendered.components ? { components: rendered.components } : {}),
      allowedMentions: { parse: [], repliedUser: false },
    })
  } catch (error) {
    console.error(`Mentioned ${identity.wikiLabel} search failed.`, error)
    await message.reply({
      content: personalityLines.pick('error'),
      allowedMentions: { parse: [], repliedUser: false },
    })
  }
}

export async function startDiscordBot(
  config: BotConfig,
  service: WikiService,
  maintenance: MaintenanceMode,
): Promise<Client> {
  const startedAt = new Date()
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  })
  const messageCommandName = wikiMessageCommandName(config.identity)

  client.once(Events.ClientReady, (readyClient) => {
    console.info(`${config.identity.productName} Discord connected as ${readyClient.user.tag}.`)
  })

  client.on(Events.InteractionCreate, (interaction) => {
    if (
      interaction.isChatInputCommand()
      && interaction.commandName === config.identity.adminCommandName
    ) {
      void runAdminCommand(interaction, config, service, maintenance, startedAt)
      return
    }

    if (interaction.isChatInputCommand() && interaction.commandName === WIKI_SLASH_COMMAND) {
      const query = interaction.options.getString('question', true)
      void runSearch(interaction, config.identity, service, maintenance, query)
      return
    }

    if (interaction.isMessageContextMenuCommand() && interaction.commandName === messageCommandName) {
      const messageText = [
        interaction.targetMessage.content,
        ...interaction.targetMessage.embeds.flatMap((embed) => [embed.title, embed.description]),
      ].filter((value): value is string => Boolean(value)).join('\n')
      void runSearch(interaction, config.identity, service, maintenance, messageText)
    }
  })

  client.on(Events.MessageCreate, (message) => {
    if (message.author.bot || !client.user || !message.mentions.users.has(client.user.id)) return
    const query = queryFromMention(message.content, client.user.id)
    if (query === null) return
    void runMentionSearch(message, config.identity, service, maintenance, query)
  })

  await client.login(config.discordToken)
  return client
}
