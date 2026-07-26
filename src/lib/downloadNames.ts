export const sanitizeDownloadStem = (value: string) => {
  const sanitized = value
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\.+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return sanitized || '학교'
}
