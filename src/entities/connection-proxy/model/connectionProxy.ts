import type {
  ConnectionProxy,
  ConnectionProxyInput,
  ConnectionProxyType,
} from './types.ts'

export type ConnectionProxyValidationCode =
  | 'nameRequired'
  | 'nameTooLong'
  | 'nameDuplicate'
  | 'urlRequired'
  | 'urlTooLong'
  | 'urlInvalid'
  | 'schemeMismatch'
  | 'authenticationUnsupported'
  | 'explicitPortRequired'

export interface ConnectionProxyValidationErrors {
  name?: ConnectionProxyValidationCode
  url?: ConnectionProxyValidationCode
}

export function createBlankConnectionProxyInput(): ConnectionProxyInput {
  return {
    name: '',
    type: 'http_connect',
    url: 'http://127.0.0.1:8080',
  }
}

export function normalizeConnectionProxyInput(input: ConnectionProxyInput): ConnectionProxyInput {
  return {
    name: input.name.trim().replace(/\s+/g, ' '),
    type: input.type,
    url: input.url.trim(),
  }
}

export function validateConnectionProxyInput(
  input: ConnectionProxyInput,
  proxies: ConnectionProxy[],
  editingId = '',
): ConnectionProxyValidationErrors {
  const normalized = normalizeConnectionProxyInput(input)
  const errors: ConnectionProxyValidationErrors = {}

  if (!normalized.name) {
    errors.name = 'nameRequired'
  } else if (normalized.name.length > 64) {
    errors.name = 'nameTooLong'
  } else if (proxies.some((proxy) => (
    proxy.id !== editingId
    && proxy.name.trim().toLocaleLowerCase() === normalized.name.toLocaleLowerCase()
  ))) {
    errors.name = 'nameDuplicate'
  }

  errors.url = validateConnectionProxyUrl(normalized.type, normalized.url)
  return errors
}

export function validateConnectionProxyUrl(
  type: ConnectionProxyType,
  value: string,
): ConnectionProxyValidationCode | undefined {
  if (!value) {
    return 'urlRequired'
  }
  if (value.length > 2048) {
    return 'urlTooLong'
  }

  const match = value.match(/^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]+)([/?#].*)?$/)
  if (!match) {
    return 'urlInvalid'
  }
  const expectedScheme = type === 'http_connect' ? 'http' : 'socks5'
  if (match[1] !== expectedScheme) {
    return 'schemeMismatch'
  }
  const authority = match[2]
  if (authority.includes('@')) {
    return 'authenticationUnsupported'
  }
  const remainder = match[3] ?? ''
  if (remainder !== '') {
    return 'urlInvalid'
  }

  const portMatch = authority.startsWith('[')
    ? authority.match(/^\[[^\]]+\]:(\d+)$/)
    : authority.match(/^[^:]+:(\d+)$/)
  if (!portMatch) {
    return 'explicitPortRequired'
  }
  const port = Number(portMatch[1])
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return 'explicitPortRequired'
  }

  try {
    const parsed = new URL(value)
    if (!parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
      return parsed.username || parsed.password ? 'authenticationUnsupported' : 'urlInvalid'
    }
  } catch {
    return 'urlInvalid'
  }
  return undefined
}

export function connectionProxyTypeLabelKey(type: ConnectionProxyType) {
  return type === 'http_connect' ? 'proxies.types.httpConnect' : 'proxies.types.socks5'
}
