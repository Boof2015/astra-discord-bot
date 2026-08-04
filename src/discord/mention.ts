export function queryFromMention(content: string, botUserId: string): string | null {
  const userMention = `<@${botUserId}>`
  const nicknameMention = `<@!${botUserId}>`
  if (!content.includes(userMention) && !content.includes(nicknameMention)) return null

  return content
    .replaceAll(userMention, ' ')
    .replaceAll(nicknameMention, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
