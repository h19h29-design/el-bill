import type { DataProvenance } from '../types'

const dayMs = 24 * 60 * 60 * 1000

export const dataProvenanceStorageKey = 'el-bill:data-provenance'
export const legacyDataModeStorageKey = 'el-bill:data-mode'
export const defaultDataProvenance: DataProvenance = {
  bills: 'sample',
  powerPlanner: 'none',
}

interface StoredPayload<T> {
  createdAt: string
  expiresAt: string
  data: T
}

const isDataProvenance = (value: unknown): value is DataProvenance => {
  if (!value || typeof value !== 'object') return false
  const provenance = value as Record<string, unknown>
  return (
    (provenance.bills === 'sample' || provenance.bills === 'uploaded') &&
    (provenance.powerPlanner === 'none' ||
      provenance.powerPlanner === 'sample' ||
      provenance.powerPlanner === 'uploaded')
  )
}

export const createExpiry = () => {
  const createdAt = new Date()
  return {
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + dayMs).toISOString(),
  }
}

export const saveWithExpiry = <T>(key: string, data: T) => {
  const existing = loadWithExpiry<T>(key)
  const payload: StoredPayload<T> = {
    ...(existing
      ? {
          createdAt: existing.createdAt,
          expiresAt: existing.expiresAt,
        }
      : createExpiry()),
    data,
  }
  localStorage.setItem(key, JSON.stringify(payload))
  return payload
}

export const loadWithExpiry = <T>(key: string): StoredPayload<T> | null => {
  const raw = localStorage.getItem(key)
  if (!raw) return null

  try {
    const payload = JSON.parse(raw) as StoredPayload<T>
    const expiresAt = new Date(payload.expiresAt).getTime()
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      localStorage.removeItem(key)
      return null
    }
    return payload
  } catch {
    localStorage.removeItem(key)
    return null
  }
}

export const loadDataProvenance = (): DataProvenance => {
  const storedProvenance = loadWithExpiry<unknown>(dataProvenanceStorageKey)
  if (storedProvenance) {
    if (isDataProvenance(storedProvenance.data)) return storedProvenance.data
    localStorage.removeItem(dataProvenanceStorageKey)
  }

  const legacyMode = loadWithExpiry<unknown>(legacyDataModeStorageKey)
  localStorage.removeItem(legacyDataModeStorageKey)
  if (legacyMode?.data !== 'sample' && legacyMode?.data !== 'uploaded') {
    return defaultDataProvenance
  }

  const migrated: DataProvenance = {
    bills: legacyMode.data,
    powerPlanner: 'none',
  }
  localStorage.setItem(
    dataProvenanceStorageKey,
    JSON.stringify({ ...legacyMode, data: migrated }),
  )
  return migrated
}

export const purgeExpiredKeys = (keys: string[]) => {
  keys.forEach((key) => loadWithExpiry(key))
}
