const maximumProjectionBytes = 16 * 1024
const maximumStringBytes = 1024
const maximumTotalStringBytes = 8 * 1024
const maximumDepth = 5
const maximumNodes = 96
const maximumCollectionEntries = 24
const redactedValue = '[已隐藏]'
const truncatedValue = '[内容已截断]'

interface ProjectionState {
  readonly seen: WeakSet<object>
  nodes: number
  remainingStringBytes: number
}

export function projectToolTimelineValue(value: unknown): unknown {
  const projected = projectValue(value, {
    seen: new WeakSet<object>(),
    nodes: 0,
    remainingStringBytes: maximumTotalStringBytes,
  }, 0)
  try {
    if (Buffer.byteLength(JSON.stringify(projected), 'utf8') <= maximumProjectionBytes) {
      return projected
    }
  } catch {
    // 非标准对象无法稳定序列化时仅保留固定摘要。
  }
  return { summary: '详情内容超过展示限制', truncated: true }
}

function projectValue(
  value: unknown,
  state: ProjectionState,
  depth: number,
  fieldName?: string,
): unknown {
  if (fieldName && sensitiveField(fieldName)) {
    return redactedValue
  }
  if (value === null || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string') {
    return projectString(value, state)
  }
  if (typeof value === 'bigint') {
    return projectString(value.toString(), state)
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return null
  }
  if (depth >= maximumDepth || state.nodes >= maximumNodes) {
    return truncatedValue
  }
  state.nodes++
  if (state.seen.has(value)) {
    return '[循环引用]'
  }
  state.seen.add(value)
  try {
    if (Array.isArray(value)) {
      const entries = value
        .slice(0, maximumCollectionEntries)
        .map((item) => projectValue(item, state, depth + 1))
      if (value.length > maximumCollectionEntries) {
        entries.push(truncatedValue)
      }
      return entries
    }
    const source = value as Record<string, unknown>
    const keys = Object.keys(source).sort()
    const result: Record<string, unknown> = {}
    for (const key of keys.slice(0, maximumCollectionEntries)) {
      const projectedKey = truncateUTF8(key, 128)
      try {
        result[projectedKey] = projectValue(source[key], state, depth + 1, key)
      } catch {
        result[projectedKey] = '[无法读取]'
      }
    }
    if (keys.length > maximumCollectionEntries) {
      result._truncated = true
    }
    return result
  } finally {
    state.seen.delete(value)
  }
}

function projectString(value: string, state: ProjectionState) {
  const sanitized = redactSensitiveText(value)
  const allowed = Math.max(0, Math.min(maximumStringBytes, state.remainingStringBytes))
  if (allowed === 0) {
    return truncatedValue
  }
  const projected = truncateUTF8(sanitized, allowed)
  state.remainingStringBytes -= Buffer.byteLength(projected, 'utf8')
  return projected === sanitized ? projected : `${projected}${truncatedValue}`
}

function sensitiveField(value: string) {
  const separated = value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
  const segments = separated.split(/[^a-z0-9]+/).filter(Boolean)
  if (segments.some((segment) => sensitiveSegment(segment))) {
    return true
  }
  const compact = segments.join('')
  return compact === 'apikey'
    || compact === 'privatekey'
    || compact === 'secretkey'
    || compact === 'accesskey'
}

function sensitiveSegment(value: string) {
  return value === 'password'
    || value === 'passwd'
    || value === 'passphrase'
    || value === 'secret'
    || value === 'token'
    || value === 'authorization'
    || value === 'cookie'
    || value === 'credential'
    || value === 'bearer'
}

function redactSensitiveText(value: string) {
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

function truncateUTF8(value: string, maximumBytes: number) {
  if (Buffer.byteLength(value, 'utf8') <= maximumBytes) {
    return value
  }
  let result = ''
  let bytes = 0
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8')
    if (bytes + size > maximumBytes) {
      break
    }
    result += character
    bytes += size
  }
  return result
}
