import assert from 'node:assert/strict'
import test from 'node:test'
import {
  InteractionContextType,
  PermissionFlagsBits,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js'
import {
  ASTRA_ADMIN_COMMAND,
  commandDefinitions,
  commandPayloads,
} from '../src/discord/commands.js'

test('registers guild-only Astra admin commands for members who can manage the server', () => {
  const definition = commandDefinitions
    .map((command) => command.toJSON())
    .find((command) => command.name === ASTRA_ADMIN_COMMAND) as
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
  const globalAdmin = commandPayloads(false)
    .find((command) => command.name === ASTRA_ADMIN_COMMAND)
  const guildAdmin = commandPayloads(true)
    .find((command) => command.name === ASTRA_ADMIN_COMMAND)

  assert.deepEqual(globalAdmin?.contexts, [InteractionContextType.Guild])
  assert.equal(guildAdmin?.contexts, undefined)
})
