import type {
  RemoteDesktopProfile,
  RemoteDesktopProfileInput,
} from '#entities/remote-desktop'
import type { RemoteDesktopGateway } from '#features/remote-desktop'
import { TermousApiError } from '#shared/api'
import type { LoadMode } from '../model/appDataState.ts'
import type { SetAppData } from '../model/runtimeTypes.ts'

export function createRemoteDesktopProfileCommands(
  api: Pick<
    RemoteDesktopGateway,
    'createRemoteDesktopProfile' | 'updateRemoteDesktopProfile' | 'deleteRemoteDesktopProfile'
  >,
  profiles: RemoteDesktopProfile[],
  setData: SetAppData,
  load: (mode?: LoadMode) => Promise<void>,
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
      const profile = await reconcileConflict(
        () => api.updateRemoteDesktopProfile(id, profileVersion(profiles, id), input),
        load,
      )
      setData((current) => ({
        ...current,
        remoteDesktopProfiles: upsertProfile(current.remoteDesktopProfiles, profile),
      }))
      return profile
    },
    async deleteRemoteDesktopProfile(id: string) {
      await reconcileConflict(
        () => api.deleteRemoteDesktopProfile(id, profileVersion(profiles, id)),
        load,
      )
      setData((current) => ({
        ...current,
        remoteDesktopProfiles: current.remoteDesktopProfiles.filter((profile) => profile.id !== id),
      }))
    },
  }
}

async function reconcileConflict<T>(
  action: () => Promise<T>,
  load: (mode?: LoadMode) => Promise<void>,
) {
  try {
    return await action()
  } catch (error) {
    if (error instanceof TermousApiError && error.status === 409) {
      try {
        await load('silent')
      } catch {
        throw error
      }
    }
    throw error
  }
}

function profileVersion(profiles: RemoteDesktopProfile[], id: string) {
  const updatedAt = profiles.find((profile) => profile.id === id)?.updated_at
  if (!updatedAt) {
    throw new Error('远程桌面配置不存在或缺少版本信息')
  }
  return updatedAt
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
