import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  SlashCommandBuilder,
} from 'discord.js'

export const WIKI_SLASH_COMMAND = 'wiki'
export const WIKI_MESSAGE_COMMAND = 'Search Astra Wiki'

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName(WIKI_SLASH_COMMAND)
    .setDescription('Find the most relevant section of the Astra user guide')
    .addStringOption((option) => option
      .setName('question')
      .setDescription('What do you want to find in the Astra Wiki?')
      .setRequired(true)
      .setMinLength(2)
      .setMaxLength(1_000)),
  new ContextMenuCommandBuilder()
    .setName(WIKI_MESSAGE_COMMAND)
    .setType(ApplicationCommandType.Message),
] as const
