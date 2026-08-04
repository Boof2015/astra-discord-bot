export type PersonalityCategory = 'highResult' | 'noResult' | 'bareMention' | 'error'

interface WeightedLine {
  id: string
  text: string
  weight: number
}

const PERSONALITY_LINES: Record<PersonalityCategory, readonly WeightedLine[]> = {
  highResult: [
    { id: 'high-yep', text: 'Yep — this should be the one:', weight: 1 },
    { id: 'high-spoken', text: 'The Wiki has spoken:', weight: 1 },
    { id: 'high-behold', text: 'Behold: documentation.', weight: 1 },
  ],
  noResult: [
    { id: 'none-pin', text: 'I couldn’t pin that one down.', weight: 0.5 },
    { id: 'none-couch', text: 'I checked under the couch. Nothing.', weight: 0.3 },
    {
      id: 'none-confused',
      text: 'The Wiki has no idea what you’re talking about. Neither do I.',
      weight: 0.2,
    },
  ],
  bareMention: [
    {
      id: 'bare-summoned',
      text: 'You have summoned the documentation creature.',
      weight: 1,
    },
    {
      id: 'bare-ask',
      text: 'Ask me something. Preferably about Astra.',
      weight: 1,
    },
  ],
  error: [
    {
      id: 'error-wiki',
      text: 'I lost track of the Wiki for a second. Try that again in a moment.',
      weight: 0.75,
    },
    {
      id: 'error-mine',
      text: 'Good news: I found a bug. Bad news: it’s mine.',
      weight: 0.25,
    },
  ],
}

export class PersonalityLinePicker {
  readonly #previousByCategory = new Map<PersonalityCategory, string>()

  pick(category: PersonalityCategory, random: () => number = Math.random): string {
    const lines = PERSONALITY_LINES[category]
    const previousId = this.#previousByCategory.get(category)
    const withoutPrevious = previousId
      ? lines.filter((line) => line.id !== previousId)
      : lines
    const candidates = withoutPrevious.length > 0 ? withoutPrevious : lines
    const totalWeight = candidates.reduce((sum, line) => sum + line.weight, 0)
    let threshold = Math.min(Math.max(random(), 0), 0.999999999999) * totalWeight
    let selected = candidates[candidates.length - 1]!

    for (const candidate of candidates) {
      threshold -= candidate.weight
      if (threshold < 0) {
        selected = candidate
        break
      }
    }

    this.#previousByCategory.set(category, selected.id)
    return selected.text
  }
}

export const personalityLines = new PersonalityLinePicker()
