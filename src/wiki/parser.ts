import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import GithubSlugger from 'github-slugger'
import type { Heading, Root, RootContent } from 'mdast'
import { toString } from 'mdast-util-to-string'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import type { WikiChunk, WikiParseOptions } from './types.js'

const DEFAULT_EXCLUDED_PAGES = new Set(['Home', '_Sidebar', '_Footer'])
const DEFAULT_MAXIMUM_HEADING_DEPTH = 3
const EXCERPT_LIMIT = 520
const BLOCK_CONTAINER_TYPES = new Set([
  'blockquote',
  'list',
  'listItem',
  'root',
  'table',
  'tableRow',
])

interface SectionDraft {
  heading: string
  headingPath: string[]
  level: number
  anchor: string | null
  nodes: RootContent[]
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function textWithBlockSpacing(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  if ('value' in value && typeof value.value === 'string') return value.value
  if ('alt' in value && typeof value.alt === 'string' && value.alt) return value.alt
  if (!('children' in value) || !Array.isArray(value.children)) return ''
  const separator = 'type' in value
    && typeof value.type === 'string'
    && BLOCK_CONTAINER_TYPES.has(value.type)
    ? ' '
    : ''
  return value.children.map(textWithBlockSpacing).join(separator)
}

function sectionText(nodes: RootContent[]): string {
  return nodes
    .map((node) => normalizeWhitespace(textWithBlockSpacing(node)))
    .filter(Boolean)
    .join('\n')
}

function excerptFrom(text: string): string {
  const compact = normalizeWhitespace(text)
  if (compact.length <= EXCERPT_LIMIT) return compact

  const candidate = compact.slice(0, EXCERPT_LIMIT + 1)
  const sentenceEnd = Math.max(
    candidate.lastIndexOf('. '),
    candidate.lastIndexOf('! '),
    candidate.lastIndexOf('? '),
  )
  if (sentenceEnd >= Math.floor(EXCERPT_LIMIT * 0.55)) {
    return candidate.slice(0, sentenceEnd + 1)
  }

  const wordEnd = candidate.lastIndexOf(' ')
  return `${candidate.slice(0, wordEnd > 0 ? wordEnd : EXCERPT_LIMIT).trimEnd()}…`
}

function pageSlugFromFile(fileName: string): string {
  return basename(fileName, '.md').replace(/\s+/g, '-')
}

function pageUrl(baseUrl: string, pageSlug: string, anchor: string | null): string {
  const encodedPage = encodeURIComponent(pageSlug)
  if (!anchor) return `${baseUrl.replace(/\/$/, '')}/${encodedPage}`
  return `${baseUrl.replace(/\/$/, '')}/${encodedPage}#${encodeURIComponent(anchor)}`
}

function hashChunk(pageSlug: string, headingPath: string[], text: string): string {
  return createHash('sha256')
    .update(`${pageSlug}\n${headingPath.join(' > ')}\n${text}`)
    .digest('hex')
}

function isHeading(node: RootContent): node is Heading {
  return node.type === 'heading'
}

function parseMarkdown(markdown: string): Root {
  return unified().use(remarkParse).use(remarkGfm).parse(markdown)
}

export function parseWikiPage(
  markdown: string,
  fileName: string,
  options: WikiParseOptions,
): WikiChunk[] {
  const root = parseMarkdown(markdown)
  const pageSlug = pageSlugFromFile(fileName)
  const maximumHeadingDepth = options.maximumHeadingDepth ?? DEFAULT_MAXIMUM_HEADING_DEPTH
  const slugger = new GithubSlugger()
  const headingStack = new Map<number, string>()
  const chunks: WikiChunk[] = []
  let pageTitle = pageSlug.replace(/-/g, ' ')
  let current: SectionDraft | null = null

  const flush = (): void => {
    if (!current) return
    const text = sectionText(current.nodes)
    if (!text) {
      current = null
      return
    }

    const id = current.anchor ? `${pageSlug}#${current.anchor}` : pageSlug
    chunks.push({
      id,
      pageSlug,
      pageTitle,
      heading: current.heading,
      headingPath: current.headingPath,
      level: current.level,
      anchor: current.anchor,
      text,
      excerpt: excerptFrom(text),
      url: pageUrl(options.baseUrl, pageSlug, current.anchor),
      sourcePath: fileName,
      contentHash: hashChunk(pageSlug, current.headingPath, text),
      aliases: [],
    })
    current = null
  }

  for (const node of root.children) {
    if (!isHeading(node)) {
      current?.nodes.push(node)
      continue
    }

    const heading = normalizeWhitespace(toString(node))
    const anchor = slugger.slug(heading)
    if (node.depth === 1 && heading) pageTitle = heading

    if (node.depth > maximumHeadingDepth) {
      current?.nodes.push(node)
      continue
    }

    flush()
    for (const depth of [...headingStack.keys()]) {
      if (depth >= node.depth) headingStack.delete(depth)
    }
    headingStack.set(node.depth, heading)
    const headingPath = [...headingStack.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, value]) => value)

    current = {
      heading,
      headingPath,
      level: node.depth,
      anchor: node.depth === 1 ? null : anchor,
      nodes: [],
    }
  }

  flush()
  return chunks.map((chunk) => ({
    ...chunk,
    pageTitle,
    headingPath: chunk.headingPath.map((heading, index) => index === 0 ? pageTitle : heading),
    contentHash: hashChunk(
      pageSlug,
      chunk.headingPath.map((heading, index) => index === 0 ? pageTitle : heading),
      chunk.text,
    ),
  }))
}

export async function parseWikiDirectory(
  directory: string,
  options: WikiParseOptions,
): Promise<WikiChunk[]> {
  const excluded = options.excludedPageSlugs ?? DEFAULT_EXCLUDED_PAGES
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))

  const chunks: WikiChunk[] = []
  for (const fileName of files) {
    if (excluded.has(pageSlugFromFile(fileName))) continue
    const markdown = await readFile(join(directory, fileName), 'utf8')
    chunks.push(...parseWikiPage(markdown, fileName, options))
  }
  return chunks
}
