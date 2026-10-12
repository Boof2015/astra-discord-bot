import { WikiService } from './app/wikiService.js'
import { MaintenanceMode } from './app/maintenanceMode.js'
import { loadConfig, loadLocalEnvironment } from './config.js'
import { startDiscordBot } from './discord/bot.js'

loadLocalEnvironment()
const config = loadConfig({ requireDiscord: true })
const wikiService = new WikiService(config)
const maintenanceMode = await MaintenanceMode.open(config.botStateFile)

console.info(`Preparing the ${config.identity.wikiLabel} index...`)
await wikiService.start()
const client = await startDiscordBot(config, wikiService, maintenanceMode)

let shuttingDown = false
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return
  shuttingDown = true
  console.info(`Received ${signal}; shutting down.`)
  wikiService.stop()
  client.destroy()
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
