export function sanitizedWorkerEnvironment(
  source: Readonly<Record<string, string | undefined>>,
) {
  const result: Record<string, string> = {}
  const allowed = [
    'LANG',
    'LC_ALL',
    'Path',
    'PATH',
    'SystemRoot',
    'TEMP',
    'TMP',
    'TMPDIR',
    'TZ',
    'WINDIR',
  ]
  for (const key of allowed) {
    const value = source[key]
    if (value !== undefined) {
      result[key] = value
    }
  }
  return result
}
