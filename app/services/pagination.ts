/** Parse a positive, bounded page value before it reaches a database query. */
export function parsePage(value: unknown, fallback = 1, maximum = 1_000_000) {
  if (value === undefined || value === '') return fallback
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value)
  if (!/^\d+$/.test(text)) return null
  const page = Number(text)
  return Number.isSafeInteger(page) && page >= 1 && page <= maximum ? page : null
}
