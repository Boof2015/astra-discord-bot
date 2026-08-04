import assert from 'node:assert/strict'
import test from 'node:test'
import { queryFromMention } from '../src/discord/mention.js'

test('extracts a question after a bot mention', () => {
  assert.equal(
    queryFromMention('<@123456> why is my sample rate weird?', '123456'),
    'why is my sample rate weird?',
  )
})

test('supports nickname-style mentions and strips repeated mentions', () => {
  assert.equal(
    queryFromMention('<@!123456> can <@123456> sync two computers?', '123456'),
    'can sync two computers?',
  )
})

test('returns an empty query for a mention by itself', () => {
  assert.equal(queryFromMention('<@123456>', '123456'), '')
})

test('ignores messages that do not mention this bot', () => {
  assert.equal(queryFromMention('<@999999> hello there', '123456'), null)
})
