const termousReleaseTagBaseURL = 'https://github.com/Countra/termous/releases/tag'

export function termousReleasePageUrl(version: string | null | undefined) {
  const normalizedVersion = version?.trim().replace(/^v(?=\d)/i, '') ?? ''
  if (!normalizedVersion) {
    return null
  }
  return `${termousReleaseTagBaseURL}/v${encodeURIComponent(normalizedVersion)}`
}
