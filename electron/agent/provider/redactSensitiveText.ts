const redactedValue = '[已隐藏]'

export function redactSensitiveText(value: string) {
  return value
    .replace(
      /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi,
      redactedValue,
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${redactedValue}`)
    .replace(
      /(password|passwd|passphrase|secret|token|api[_-]?key|private[_-]?key|authorization|cookie|credential)\s*[:=]\s*([^\s,;]+)/gi,
      `$1=${redactedValue}`,
    )
}
