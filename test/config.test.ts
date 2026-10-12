import assert from 'node:assert/strict'
import test from 'node:test'
import { loadConfig } from '../src/config.js'

const IDENTITY_ENVIRONMENT = [
  'BOT_PRODUCT_NAME',
  'BOT_ADMIN_COMMAND_NAME',
  'BOT_ACCENT_COLOR',
] as const

function withIdentityEnvironment(
  values: Partial<Record<(typeof IDENTITY_ENVIRONMENT)[number], string>>,
  operation: () => void,
): void {
  const previous = Object.fromEntries(
    IDENTITY_ENVIRONMENT.map((name) => [name, process.env[name]]),
  ) as Record<(typeof IDENTITY_ENVIRONMENT)[number], string | undefined>

  try {
    for (const name of IDENTITY_ENVIRONMENT) {
      const value = values[name]
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    operation()
  } finally {
    for (const name of IDENTITY_ENVIRONMENT) {
      const value = previous[name]
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

test('uses the Astra identity by default', () => {
  withIdentityEnvironment({}, () => {
    assert.deepEqual(loadConfig({ requireDiscord: false }).identity, {
      productName: 'Astra',
      adminCommandName: 'astra',
      wikiLabel: 'Astra Wiki',
      accentColor: 0x8b5cf6,
    })
  })
})

test('loads a branded Prism identity', () => {
  withIdentityEnvironment({
    BOT_PRODUCT_NAME: 'Prism',
    BOT_ADMIN_COMMAND_NAME: 'prism',
    BOT_ACCENT_COLOR: '#22D3EE',
  }, () => {
    assert.deepEqual(loadConfig({ requireDiscord: false }).identity, {
      productName: 'Prism',
      adminCommandName: 'prism',
      wikiLabel: 'Prism Wiki',
      accentColor: 0x22d3ee,
    })
  })
})

test('rejects an invalid Discord admin command name', () => {
  withIdentityEnvironment({ BOT_ADMIN_COMMAND_NAME: 'Prism Bot' }, () => {
    assert.throws(
      () => loadConfig({ requireDiscord: false }),
      /BOT_ADMIN_COMMAND_NAME/,
    )
  })
})

test('rejects an invalid accent color', () => {
  withIdentityEnvironment({ BOT_ACCENT_COLOR: 'cyan' }, () => {
    assert.throws(
      () => loadConfig({ requireDiscord: false }),
      /BOT_ACCENT_COLOR/,
    )
  })
})
