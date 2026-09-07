import type { Host } from '#entities/host'
import type { HostAsset } from '#entities/host-asset'
import type { Session } from './sessionTypes.ts'

export function markHostRecentlyConnected(
  hosts: Host[],
  hostAssets: HostAsset[],
  sessions: Session[],
  sessionId: string,
  patch: Partial<Session>,
) {
  const sessionsWithPatch = sessions.map((session) => (
    session.id === sessionId ? { ...session, ...patch } : session
  ))
  const updatedSession = sessionsWithPatch.find((session) => session.id === sessionId)
  if (updatedSession?.kind !== 'ssh' || updatedSession.status !== 'connected' || !updatedSession.host_id) {
    return { hosts, hostAssets, sessions: sessionsWithPatch }
  }
  const connectedAt = updatedSession.connected_at ?? new Date().toISOString()
  return {
    hosts: hosts.map((host) => (
      host.id === updatedSession.host_id
        ? withLegacyHostRecentTimestamp(host, connectedAt)
        : host
    )),
    hostAssets: hostAssets.map((host) => (
      host.id === updatedSession.host_id
        ? withHostAssetRecentTimestamp(host, connectedAt)
        : host
    )),
    sessions: sessionsWithPatch,
  }
}

export function reconcileHostRecentTimestamps(
  currentHosts: Host[],
  reloadedHosts: Host[],
  currentHostAssets: HostAsset[],
  reloadedHostAssets: HostAsset[],
) {
  const currentHostsById = new Map(currentHosts.map((host) => [host.id, host]))
  const currentAssetsById = new Map(currentHostAssets.map((host) => [host.id, host]))
  return {
    hosts: reloadedHosts.map((host) => withLegacyHostRecentTimestamp(
      host,
      currentHostsById.get(host.id)?.last_connected_at,
    )),
    hostAssets: reloadedHostAssets.map((host) => withHostAssetRecentTimestamp(
      host,
      currentAssetsById.get(host.id)?.last_accessed_at,
    )),
  }
}

function withLegacyHostRecentTimestamp(host: Host, candidate?: string) {
  const lastConnectedAt = latestTimestamp(host.last_connected_at, candidate)
  return lastConnectedAt === host.last_connected_at
    ? host
    : { ...host, last_connected_at: lastConnectedAt }
}

function withHostAssetRecentTimestamp(host: HostAsset, candidate?: string) {
  const lastAccessedAt = latestTimestamp(host.last_accessed_at, candidate)
  return lastAccessedAt === host.last_accessed_at
    ? host
    : { ...host, last_accessed_at: lastAccessedAt }
}

function latestTimestamp(current?: string, candidate?: string) {
  if (!candidate) return current
  if (!current) return candidate
  if (current === candidate) return current
  const currentTime = Date.parse(current)
  const candidateTime = Date.parse(candidate)
  if (!Number.isFinite(currentTime)) return candidate
  if (!Number.isFinite(candidateTime)) return current
  // Date.parse 只有毫秒精度；同一毫秒内优先保留调用方传入的新状态，避免纳秒时间被迟到快照回退。
  return candidateTime >= currentTime ? candidate : current
}
