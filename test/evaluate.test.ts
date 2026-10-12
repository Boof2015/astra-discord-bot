import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

test('semantic evaluation fails instead of passing on lexical fallback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wiki-evaluation-'))
  try {
    await Promise.all([
      writeFile(join(directory, 'Guide.md'), '# Guide\nInstructions for the guide.'),
      writeFile(join(directory, 'aliases.yml'), 'aliases: {}\n'),
      writeFile(join(directory, 'queries.yml'), 'queries:\n  - query: guide\n    expected: Guide\n'),
    ])
    const evaluation = spawnSync(process.execPath, [
      fileURLToPath(new URL('../src/cli/evaluate.js', import.meta.url)), '--semantic',
    ], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        WIKI_DIRECTORY: directory,
        ALIASES_FILE: join(directory, 'aliases.yml'),
        EVALUATION_PATH: join(directory, 'queries.yml'),
        EMBEDDING_MODEL: 'unsupported-test-model',
      },
    })
    assert.ifError(evaluation.error)
    assert.equal(evaluation.status, 1)
    assert.match(evaluation.stderr, /Semantic evaluation requires the semantic engine/)
    assert.doesNotMatch(evaluation.stdout, /Regression floor:.*pass/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
