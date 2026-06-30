const dayMs = 24 * 60 * 60 * 1000

interface StoredPayload<T> {
  createdAt: string
  expiresAt: string
  data: T
}

export const createExpiry = () => {
  const createdAt = new Date()
  return {
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + dayMs).toISOString(),
  }
}

export const saveWithExpiry = <T>(key: string, data: T) => {
  const payload: StoredPayload<T> = {
    ...createExpiry(),
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
    if (!payload.expiresAt || new Date(payload.expiresAt).getTime() <= Date.now()) {
      localStorage.removeItem(key)
      return null
    }
    return payload
  } catch {
    localStorage.removeItem(key)
    return null
  }
}

export const purgeExpiredKeys = (keys: string[]) => {
  keys.forEach((key) => loadWithExpiry(key))
}
