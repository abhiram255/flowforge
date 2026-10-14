import { OBJECT_ID_REGEX } from '@flowforge/shared'

export function isObjectId(value: string): boolean {
  return OBJECT_ID_REGEX.test(value)
}

/** Parse durations like `15m`, `2h`, `30s`, `1d` into seconds. */
export function parseDuration(input: string): number {
  const match = /^(\d+)(s|m|h|d)?$/.exec(input.trim())
  if (!match || !match[1]) throw new Error(`Invalid duration: ${input}`)
  const value = Number(match[1])
  const unit = match[2] ?? 's'
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }
  return value * (multipliers[unit] as number)
}

export function uniq<T>(values: T[]): T[] {
  return [...new Set(values)]
}

export function toIdString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'toString' in value) return String(value)
  return ''
}

export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}
