import assert from 'node:assert/strict'
import test from 'node:test'
import { parseWikiPage } from '../src/wiki/parser.js'

test('parses page and nested sections with GitHub-compatible duplicate anchors', () => {
  const chunks = parseWikiPage(
    `# Audio & Output

Page introduction.

## Common Problems

General help.

### Device Busy

Close the other player.

## Common Problems

Another section with the same name.
`,
    'Audio Output.md',
    { baseUrl: 'https://example.test/wiki' },
  )

  assert.deepEqual(chunks.map((chunk) => chunk.id), [
    'Audio-Output',
    'Audio-Output#common-problems',
    'Audio-Output#device-busy',
    'Audio-Output#common-problems-1',
  ])
  assert.equal(chunks[0]?.pageTitle, 'Audio & Output')
  assert.deepEqual(chunks[2]?.headingPath, ['Audio & Output', 'Common Problems', 'Device Busy'])
  assert.equal(chunks[2]?.url, 'https://example.test/wiki/Audio-Output#device-busy')
})

test('extracts useful text from GitHub-flavored Markdown tables', () => {
  const [chunk] = parseWikiPage(
    `# Meter

| Setting | Meaning |
| --- | --- |
| FFT | More detail costs more CPU. |
`,
    'Meter.md',
    { baseUrl: 'https://example.test/wiki' },
  )

  assert.match(chunk?.text ?? '', /FFT/)
  assert.match(chunk?.text ?? '', /More detail costs more CPU/)
})
