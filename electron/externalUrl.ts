import type {
  ExternalUrlOpenResult,
  ExternalUrlValidationResult,
} from '#common/contracts'

export type {
  ExternalUrlOpenError,
  ExternalUrlOpenResult,
  ExternalUrlValidationError,
  ExternalUrlValidationResult,
} from '#common/contracts'

export const externalUrlMaxBytes = 2_048

function containsControlCharacter(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159)) {
      return true
    }
  }
  return false
}

export function validateExternalUrl(value: unknown): ExternalUrlValidationResult {
  if (
    typeof value !== 'string'
    || value === ''
    || value !== value.trim()
    || containsControlCharacter(value)
  ) {
    return { ok: false, error: 'external_url_invalid' }
  }
  if (Buffer.byteLength(value, 'utf8') > externalUrlMaxBytes) {
    return { ok: false, error: 'external_url_too_long' }
  }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return { ok: false, error: 'external_url_invalid' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'external_url_protocol_not_allowed' }
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, error: 'external_url_credentials_not_allowed' }
  }
  if (parsed.hostname === '') {
    return { ok: false, error: 'external_url_invalid' }
  }
  return { ok: true, url: parsed.href }
}

export async function openExternalUrl(
  value: unknown,
  opener: (url: string) => Promise<void>,
): Promise<ExternalUrlOpenResult> {
  const validated = validateExternalUrl(value)
  if (!validated.ok) {
    return validated
  }
  try {
    await opener(validated.url)
    return { ok: true }
  } catch {
    return { ok: false, error: 'external_url_open_failed' }
  }
}
