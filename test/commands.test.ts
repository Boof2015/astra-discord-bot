import assert from 'node:assert/strict'
import test from 'node:test'
import {
  InteractionContextType,
  PermissionFlagsBits,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js'
import {
  createCommandDefinitions,
  commandPayloads,
  wikiMessageCommandName,
} from '../src/discord/commands.js'
import type { BotIdentity } from '../src/config.js'

const ASTRA_IDENTITY: BotIdentity = {
  productName: 'Astra',
  adminCommandName: 'astra',
  wikiLabel: 'Astra Wiki',
  accentColor: 0x8b5cf6,
}

const PRISM_IDENTITY: BotIdentity = {
  productName: 'Prism',
  adminCommandName: 'prism',
  wikiLabel: 'Prism Wiki',
  accentColor: 0x22d3ee,
}

test('registers guild-only Astra admin commands for members who can manage the server', () => {
  const definition = createCommandDefinitions(ASTRA_IDENTITY)
    .map((command) => command.toJSON())
    .find((command) => command.name === ASTRA_IDENTITY.adminCommandName) as
      RESTPostAPIChatInputApplicationCommandsJSONBody | undefined

  assert.ok(definition)
  assert.equal(
    definition.default_member_permissions,
    PermissionFlagsBits.ManageGuild.toString(),
  )
  assert.deepEqual(definition.contexts, [InteractionContextType.Guild])
  assert.deepEqual(
    definition.options?.map((option) => option.name),
    ['status', 'refresh', 'inspect', 'pause', 'resume'],
  )
})

test('omits global-only command contexts during development guild registration', () => {
  const globalAdmin = commandPayloads(ASTRA_IDENTITY, false)
    .find((command) => command.name === ASTRA_IDENTITY.adminCommandName)
  const guildAdmin = commandPayloads(ASTRA_IDENTITY, true)
    .find((command) => command.name === ASTRA_IDENTITY.adminCommandName)

  assert.deepEqual(globalAdmin?.contexts, [InteractionContextType.Guild])
  assert.equal(guildAdmin?.contexts, undefined)
})

test('brands Prism commands without changing the public wiki command name', () => {
  const commands = createCommandDefinitions(PRISM_IDENTITY).map((command) => command.toJSON())
  const slash = commands.find((command) => command.name === 'wiki')
  const message = commands.find((command) => command.name === wikiMessageCommandName(PRISM_IDENTITY))
  const admin = commands.find((command) => command.name === PRISM_IDENTITY.adminCommandName)

  assert.match(slash && 'description' in slash ? slash.description : '', /Prism/)
  assert.equal(message?.name, 'Search Prism Wiki')
  assert.equal(admin?.name, 'prism')
  assert.match(admin && 'description' in admin ? admin.description : '', /Prism Wiki/)
})
