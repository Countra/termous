import type { RemoteDesktopSession } from '#entities/remote-desktop'

export function countRemoteDesktopProfileRuntimeUsage(
  profileId: string,
  sessions: readonly RemoteDesktopSession[],
) {
  if (!profileId) return 0
  return sessions.filter((session) => session.profile_id === profileId).length
}
