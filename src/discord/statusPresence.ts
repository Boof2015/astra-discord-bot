import { ActivityType, Events, type Client } from 'discord.js'
import { loadStatusCatalog } from '../app/statusCatalog.js'
import { FileHeartbeatStore, StatusRotation } from '../app/statusRotation.js'
import type { BotConfig } from '../config.js'

export async function startStatusPresence(client: Client, config: BotConfig): Promise<() => Promise<void>> {
  const product = config.identity.productName.toLowerCase()
  if (product !== 'astra' && product !== 'prism') return async () => {}
  try {
    const catalog = await loadStatusCatalog(config.statusMessagesFile)
    if (catalog.solos[product].length === 0) {
      console.info(`${config.identity.productName} status rotation is waiting for status messages.`)
      return async () => {}
    }
    let connected = client.isReady()
    const rotation = new StatusRotation(
      catalog, product, new FileHeartbeatStore(config.statusSharedDirectory, product),
      {
        isReady: () => connected && client.isReady(),
        setStatus: (text) => {
          client.user?.setPresence({
            activities: text ? [{ name: 'Custom Status', type: ActivityType.Custom, state: text }] : [],
          })
        },
      },
    )
    const disconnect = () => { connected = false; void rotation.tick() }
    const reconnect = () => { connected = true; rotation.reconnect() }
    client.on(Events.ShardDisconnect, disconnect)
    client.on(Events.ShardReconnecting, disconnect)
    client.on(Events.Invalidated, disconnect)
    client.on(Events.ClientReady, reconnect)
    client.on(Events.ShardReady, reconnect)
    client.on(Events.ShardResume, reconnect)
    await rotation.start()
    console.info(`${config.identity.productName} status rotation started (${catalog.rotationMinutes} minute slots).`)
    return async () => {
      client.off(Events.ShardDisconnect, disconnect)
      client.off(Events.ShardReconnecting, disconnect)
      client.off(Events.Invalidated, disconnect)
      client.off(Events.ClientReady, reconnect)
      client.off(Events.ShardReady, reconnect)
      client.off(Events.ShardResume, reconnect)
      await rotation.stop()
    }
  } catch (error) {
    console.error('Status rotation could not start; wiki searches remain available.', error)
    return async () => {}
  }
}
