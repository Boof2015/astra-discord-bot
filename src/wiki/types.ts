export interface WikiChunk {
  id: string
  pageSlug: string
  pageTitle: string
  heading: string
  headingPath: string[]
  level: number
  anchor: string | null
  text: string
  excerpt: string
  url: string
  sourcePath: string
  contentHash: string
  aliases: string[]
}

export interface WikiParseOptions {
  baseUrl: string
  excludedPageSlugs?: ReadonlySet<string>
  maximumHeadingDepth?: number
}

export interface WikiAliasConfig {
  aliases: Record<string, string[]>
}
