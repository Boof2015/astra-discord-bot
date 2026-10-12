import assert from 'node:assert/strict'
import test from 'node:test'
import { PersonalityLinePicker } from '../src/discord/personality.js'

test('selects from the approved high-confidence result lines', () => {
  const picker = new PersonalityLinePicker()

  assert.equal(picker.pick('highResult', () => 0), 'Yep — this should be the one:')
  assert.equal(picker.pick('highResult', () => 0), 'The Wiki has spoken:')
  assert.equal(picker.pick('highResult', () => 0.999), 'Behold: documentation.')
})

test('does not immediately repeat a personality line', () => {
  const picker = new PersonalityLinePicker()
  const first = picker.pick('noResult', () => 0)
  const second = picker.pick('noResult', () => 0)

  assert.notEqual(first, second)
})

test('uses the configured weights when there is no previous line', () => {
  const picker = new PersonalityLinePicker()

  assert.equal(picker.pick('noResult', () => 0.49), 'I couldn’t pin that one down.')
  const anotherPicker = new PersonalityLinePicker()
  assert.equal(anotherPicker.pick('noResult', () => 0.51), 'I checked under the couch. Nothing.')
  const finalPicker = new PersonalityLinePicker()
  assert.equal(
    finalPicker.pick('noResult', () => 0.9),
    'The Wiki has no idea what you’re talking about. Neither do I.',
  )
})

test('uses the configured product name in branded lines', () => {
  const picker = new PersonalityLinePicker()

  assert.equal(
    picker.pickForProduct('bareMention', 'Prism', () => 0.999),
    'Ask me something. Preferably about Prism.',
  )
})
