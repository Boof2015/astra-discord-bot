const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'because', 'but', 'by', 'can', 'could',
  'do', 'does', 'for', 'from', 'get', 'got', 'had', 'has', 'have', 'how', 'i', 'if',
  'in', 'into', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or', 'should', 'that',
  'the', 'their', 'this', 'to', 'was', 'what', 'when', 'where', 'which', 'why',
  'will', 'with', 'would', 'you', 'your',
])

export function normalizeSearchPhrase(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/([0-9])\.([0-9])/g, '$1_$2')
    .replace(/[’']/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stem(token: string): string {
  if (token.length > 5 && token.endsWith('ies')) return `${token.slice(0, -3)}y`
  if (token.length > 6 && token.endsWith('ing')) return token.slice(0, -3)
  if (token.length > 5 && token.endsWith('ed')) return token.slice(0, -2)
  if (token.length > 5 && token.endsWith('es')) return token.slice(0, -2)
  if (token.length > 4 && token.endsWith('s')) return token.slice(0, -1)
  return token
}

export function tokenize(value: string): string[] {
  const normalized = normalizeSearchPhrase(value)
  if (!normalized) return []
  return normalized
    .split(' ')
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .map(stem)
}
