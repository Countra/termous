import type { RemoteDesktopSession } from '#entities/remote-desktop'

const rfc3339Pattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/

export function shouldAcceptSessionSnapshot(
  current: RemoteDesktopSession | undefined,
  incoming: RemoteDesktopSession,
) {
  if (!current) {
    return true
  }
  if (incoming.connection_generation !== current.connection_generation) {
    return incoming.connection_generation > current.connection_generation
  }

  const currentUpdatedAt = parseRfc3339Nanoseconds(current.updated_at)
  const incomingUpdatedAt = parseRfc3339Nanoseconds(incoming.updated_at)
  if (currentUpdatedAt === null || incomingUpdatedAt === null) {
    return incoming.updated_at === current.updated_at
  }
  return incomingUpdatedAt >= currentUpdatedAt
}

function parseRfc3339Nanoseconds(value: string) {
  const match = rfc3339Pattern.exec(value)
  if (!match) {
    return null
  }
  const fraction = (match[2] ?? '').padEnd(9, '0')
  const milliseconds = Date.parse(`${match[1]}.${fraction.slice(0, 3)}${match[3]}`)
  if (!Number.isFinite(milliseconds)) {
    return null
  }
  return BigInt(milliseconds) * 1_000_000n + BigInt(fraction.slice(3))
}
