import type {
  RemoteDesktopProfileInput,
} from '#entities/remote-desktop'
import type { RemoteDesktopGateway } from '#features/remote-desktop'
import type { SetAppData } from '../model/runtimeTypes.ts'

export function createRemoteDesktopProfileCommands(
  api: Pick<
    RemoteDesktopGateway,
    'createRemoteDesktopProfile' | 'updateRemoteDesktopProfile' | 'deleteRemoteDesktopProfile'
  >,
  setData: SetAppData,
) {
  return {
    async createRemoteDesktopProfile(input: RemoteDesktopProfileInput) {
      const profile = await api.createRemoteDesktopProfile(input)
      setData((current) => ({
        ...current,
        remoteDesktopProfiles: upsertProfile(current.remoteDesktopProfiles, profile),
      }))
      return profile
    },
    async updateRemoteDesktopProfile(id: string, input: RemoteDesktopProfileInput) {
      const profile = await api.updateRemoteDesktopProfile(id, input)
      setData((current) => ({
        ...current,
        remoteDesktopProfiles: upsertProfile(current.remoteDesktopProfiles, profile),
      }))
      return profile
    },
    async deleteRemoteDesktopProfile(id: string) {
      await api.deleteRemoteDesktopProfile(id)
      setData((current) => ({
        ...current,
        remoteDesktopProfiles: current.remoteDesktopProfiles.filter((profile) => profile.id !== id),
      }))
    },
  }
}

function upsertProfile<T extends { id: string; name: string }>(profiles: T[], profile: T) {
  return sortProfiles([
    ...profiles.filter((item) => item.id !== profile.id),
    profile,
  ])
}

function sortProfiles<T extends { name: string; id: string }>(profiles: T[]) {
  return [...profiles].sort((left, right) => (
    left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
  ))
}
