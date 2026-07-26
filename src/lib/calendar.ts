export interface CalendarParts {
  year: number
  month: number
  day?: number
}

const isValidYear = (year: number) =>
  Number.isInteger(year) && year >= 2000 && year <= 2100

const isValidMonth = (month: number) =>
  Number.isInteger(month) && month >= 1 && month <= 12

const isValidDay = (year: number, month: number, day: number) => {
  if (!Number.isInteger(day) || day < 1 || day > 31) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  )
}

export const parseStrictMonth = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return isValidMonth(value) ? value : null
  }
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^(0?[1-9]|1[0-2])(?:\s*월)?$/)
  if (!match) return null
  return Number(match[1])
}

export const parseStrictCalendarValue = (
  value: unknown,
): CalendarParts | null => {
  if (value instanceof Date) {
    const year = value.getFullYear()
    const month = value.getMonth() + 1
    const day = value.getDate()
    return Number.isFinite(value.getTime()) && isValidYear(year)
      ? { year, month, day }
      : null
  }
  if (typeof value !== 'string') return null
  const raw = value.trim()
  const korean = raw.match(
    /^(\d{4})년\s*(\d{1,2})월(?:\s*(\d{1,2})일)?$/,
  )
  const common = raw.match(
    /^(\d{4})([-/.])(\d{1,2})(?:\2(\d{1,2}))?$/,
  )
  const year = Number(korean?.[1] ?? common?.[1])
  const month = Number(korean?.[2] ?? common?.[3])
  const dayRaw = korean?.[3] ?? common?.[4]
  if (!isValidYear(year) || !isValidMonth(month)) return null
  if (dayRaw === undefined) return { year, month }
  const day = Number(dayRaw)
  return isValidDay(year, month, day) ? { year, month, day } : null
}

export const isValidCalendarDate = (value: unknown) =>
  parseStrictCalendarValue(value)?.day !== undefined

export const isValidCalendarMonth = (value: unknown) =>
  parseStrictCalendarValue(value) !== null
