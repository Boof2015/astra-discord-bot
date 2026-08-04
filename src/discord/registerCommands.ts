import { REST, Routes } from 'discord.js'
import { loadConfig, loadLocalEnvironment } from '../config.js'
import { commandDefinitions } from './commands.js'

loadLocalEnvironment()
const config = loadConfig({ requireDiscord: true })
const rest = new REST({ version: '10' }).setToken(config.discordToken)
const body = commandDefinitions.map((command) => command.toJSON())

if (config.discordGuildId) {
  await rest.put(
    Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId),
    { body },
  )
  console.info(`Registered ${body.length} commands in guild ${config.discordGuildId}.`)
} else {
  await rest.put(Routes.applicationCommands(config.discordClientId), { body })
  console.info(`Registered ${body.length} global commands.`)
}
