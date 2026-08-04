import assert from 'node:assert/strict'
import test from 'node:test'
import { applyAliases } from '../src/wiki/aliases.js'
import type { WikiChunk } from '../src/wiki/types.js'

function chunk(id: string): WikiChunk {
  const [pageSlug = id, anchor] = id.split('#')
  return {
    id,
    pageSlug,
    pageTitle: pageSlug,
    heading: anchor ?? pageSlug,
    headingPath: [pageSlug, ...(anchor ? [anchor] : [])],
    level: anchor ? 2 : 1,
    anchor: anchor ?? null,
    text: 'Documentation text.',
    excerpt: 'Documentation text.',
    url: `https://example.test/${id}`,
    sourcePath: `${pageSlug}.md`,
    contentHash: id,
    aliases: [],
  }
}

test('page aliases stay on the page overview while section aliases stay on their section', () => {
  const chunks = applyAliases(
    [chunk('Parallax'), chunk('Parallax#pair-a-speaker')],
    {
      Parallax: ['network speakers'],
      'Parallax#pair-a-speaker': ['pair a receiver'],
    },
  )

  assert.deepEqual(chunks[0]?.aliases, ['network speakers'])
  assert.deepEqual(chunks[1]?.aliases, ['pair a receiver'])
})
