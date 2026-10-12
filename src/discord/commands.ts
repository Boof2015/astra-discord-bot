import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js'
import type { BotIdentity } from '../config.js'

export const WIKI_SLASH_COMMAND = 'wiki'

export function wikiMessageCommandName(identity: BotIdentity): string {
  return `Search ${identity.wikiLabel}`
}

export function createCommandDefinitions(identity: BotIdentity) {
  return [
    new SlashCommandBuilder()
      .setName(WIKI_SLASH_COMMAND)
      .setDescription(`Find the most relevant section of the ${identity.productName} user guide`)
      .addStringOption((option) => option
        .setName('question')
        .setDescription(`What do you want to find in the ${identity.wikiLabel}?`)
        .setRequired(true)
        .setMinLength(2)
        .setMaxLength(1_000)),
    new ContextMenuCommandBuilder()
      .setName(wikiMessageCommandName(identity))
      .setType(ApplicationCommandType.Message),
    new SlashCommandBuilder()
      .setName(identity.adminCommandName)
      .setDescription(`Manage ${identity.wikiLabel} Bot`)
      .setContexts(InteractionContextType.Guild)
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((command) => command
        .setName('status')
        .setDescription('Show the bot, Wiki index, and maintenance status'))
      .addSubcommand((command) => command
        .setName('refresh')
        .setDescription('Pull the Wiki and rebuild the search index'))
      .addSubcommand((command) => command
        .setName('inspect')
        .setDescription('Show retrieval diagnostics for a question')
        .addStringOption((option) => option
          .setName('question')
          .setDescription('Question to inspect')
          .setRequired(true)
          .setMinLength(2)
          .setMaxLength(1_000)))
      .addSubcommand((command) => command
        .setName('pause')
        .setDescription('Temporarily stop public Wiki searches')
        .addIntegerOption((option) => option
          .setName('minutes')
          .setDescription('Automatically resume after this many minutes')
          .setMinValue(1)
          .setMaxValue(10_080))
        .addStringOption((option) => option
          .setName('reason')
          .setDescription('Optional maintenance message for users')
          .setMaxLength(200)))
      .addSubcommand((command) => command
        .setName('resume')
        .setDescription('Resume public Wiki searches')),
  ] as const
}

export function commandPayloads(
  identity: BotIdentity,
  guildScoped: boolean,
): Array<Record<string, unknown>> {
  return createCommandDefinitions(identity).map((command) => {
    const payload = command.toJSON() as unknown as Record<string, unknown>
    if (!guildScoped) return payload
    const guildPayload = { ...payload }
    delete guildPayload.contexts
    delete guildPayload.integration_types
    return guildPayload
  })
}
