import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import type { WikiAliasConfig, WikiChunk } from './types.js'

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

export async function loadAliases(filePath: string): Promise<Record<string, string[]>> {
  const source = await readFile(filePath, 'utf8')
  const parsed: unknown = parse(source)
  if (!parsed || typeof parsed !== 'object' || !('aliases' in parsed)) {
    throw new Error(`Alias file ${filePath} must contain an aliases mapping.`)
  }

  const aliasesValue = (parsed as { aliases: unknown }).aliases
  if (!aliasesValue || typeof aliasesValue !== 'object' || Array.isArray(aliasesValue)) {
    throw new Error(`Alias file ${filePath} has an invalid aliases mapping.`)
  }

  const aliases: Record<string, string[]> = {}
  for (const [id, value] of Object.entries(aliasesValue)) {
    if (!isStringArray(value)) {
      throw new Error(`Aliases for ${id} must be a list of strings.`)
    }
    aliases[id] = [...new Set(value.map((entry) => entry.trim()).filter(Boolean))]
  }
  return aliases
}

export function applyAliases(
  chunks: WikiChunk[],
  aliasesById: Readonly<Record<string, string[]>>,
): WikiChunk[] {
  return chunks.map((chunk) => ({
    ...chunk,
    aliases: [...new Set([
      ...(chunk.id === chunk.pageSlug ? (aliasesById[chunk.pageSlug] ?? []) : []),
      ...(aliasesById[chunk.id] ?? []),
    ])],
  }))
}
