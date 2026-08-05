import assert from 'node:assert/strict'
import test from 'node:test'
import { parseEvaluationSource } from '../src/evaluation/cases.js'

test('expands grouped intent variants into evaluation queries', () => {
  const queries = parseEvaluationSource({
    intents: [
      {
        name: 'parallax-overview',
        expected: 'Parallax',
        variants: ['where is parallax', 'what does parallax do'],
      },
      {
        name: 'unrelated',
        expected: [],
        variants: ['bread'],
      },
    ],
  }, '/tmp/connectivity.yml')

  assert.deepEqual(queries, [
    {
      intent: 'connectivity:parallax-overview',
      query: 'where is parallax',
      expected: ['Parallax'],
      source: '/tmp/connectivity.yml',
    },
    {
      intent: 'connectivity:parallax-overview',
      query: 'what does parallax do',
      expected: ['Parallax'],
      source: '/tmp/connectivity.yml',
    },
    {
      intent: 'connectivity:unrelated',
      query: 'bread',
      expected: [],
      source: '/tmp/connectivity.yml',
    },
  ])
})

test('rejects grouped intents without variants', () => {
  assert.throws(
    () => parseEvaluationSource({
      intents: [{ name: 'empty', expected: 'Home', variants: [] }],
    }, 'bad.yml'),
    /at least one query variant/,
  )
})
