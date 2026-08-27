export const remoteDesktopTargetHostMaxLength = 45

export function isRemoteDesktopLoopbackAddress(value: string) {
  return value === '127.0.0.1' || value === '::1'
}

export function isValidRemoteDesktopIPAddress(value: string) {
  if (
    !value
    || value !== value.trim()
    || value.length > remoteDesktopTargetHostMaxLength
  ) {
    return false
  }
  const ipv4 = parseIPv4Address(value)
  if (ipv4) {
    return isAllowedIPv4Address(ipv4)
  }
  const ipv6 = parseIPv6Address(value)
  if (!ipv6 || ipv6.every((part) => part === 0) || (ipv6[0]! & 0xff00) === 0xff00) {
    return false
  }
  const mappedIPv4 = mappedIPv4Address(ipv6)
  return !mappedIPv4 || isAllowedIPv4Address(mappedIPv4)
}

export function normalizeRemoteDesktopIPAddress(value: string) {
  const normalized = value.trim()
  if (!isValidRemoteDesktopIPAddress(normalized)) {
    return normalized
  }
  const ipv4 = parseIPv4Address(normalized)
  if (ipv4) {
    return ipv4.join('.')
  }
  const ipv6 = parseIPv6Address(normalized)
  const mappedIPv4 = ipv6 ? mappedIPv4Address(ipv6) : null
  if (mappedIPv4) {
    return mappedIPv4.join('.')
  }
  return normalizeIPv6Address(normalized) ?? normalized
}

function parseIPv4Address(value: string) {
  const parts = value.split('.')
  if (parts.length !== 4 || !parts.every((part) => (
    /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255
  ))) {
    return null
  }
  return parts.map(Number)
}

function isAllowedIPv4Address(parts: number[]) {
  const first = parts[0] ?? 0
  return !parts.every((part) => part === 0)
    && !(parts[0] === 255 && parts.slice(1).every((part) => part === 255))
    && !(first >= 224 && first <= 239)
}

function parseIPv6Address(value: string) {
  const normalized = normalizeIPv6Address(value)
  if (!normalized) {
    return null
  }
  const halves = normalized.split('::')
  if (halves.length > 2) {
    return null
  }
  const left = parseIPv6Groups(halves[0] ?? '')
  const right = parseIPv6Groups(halves[1] ?? '')
  if (!left || !right) {
    return null
  }
  if (halves.length === 1) {
    return left.length === 8 ? left : null
  }
  const omitted = 8 - left.length - right.length
  return omitted > 0 ? [...left, ...Array<number>(omitted).fill(0), ...right] : null
}

function normalizeIPv6Address(value: string) {
  if (!value.includes(':') || value.includes('%')) {
    return null
  }
  try {
    const parsed = new URL(`http://[${value}]/`)
    return parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
      ? parsed.hostname.slice(1, -1).toLocaleLowerCase()
      : null
  } catch {
    return null
  }
}

function parseIPv6Groups(value: string) {
  if (!value) {
    return []
  }
  const groups = value.split(':')
  return groups.every((group) => /^[\da-f]{1,4}$/i.test(group))
    ? groups.map((group) => Number.parseInt(group, 16))
    : null
}

function mappedIPv4Address(parts: number[]) {
  if (
    parts.length !== 8
    || parts.slice(0, 5).some((part) => part !== 0)
    || parts[5] !== 0xffff
  ) {
    return null
  }
  return [
    (parts[6]! >> 8) & 0xff,
    parts[6]! & 0xff,
    (parts[7]! >> 8) & 0xff,
    parts[7]! & 0xff,
  ]
}
