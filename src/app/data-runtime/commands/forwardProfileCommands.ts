import type { TermousApi } from '../api/runtimeApi'
import type { ForwardProfileInput } from '#entities/forward'
import { upsertForwardProfile } from '../model/forwardRuntimeState'
import type { SetAppData } from '../model/runtimeTypes'

export function createForwardProfileCommands(api: TermousApi, setData: SetAppData) {
  return {
    async createForwardProfile(input: ForwardProfileInput) {
      const profile = await api.createForwardProfile(input)
      setData((current) => ({ ...current, forwardProfiles: upsertForwardProfile(current.forwardProfiles, profile) }))
      return profile
    },
    async updateForwardProfile(id: string, input: ForwardProfileInput) {
      const profile = await api.updateForwardProfile(id, input)
      setData((current) => ({ ...current, forwardProfiles: upsertForwardProfile(current.forwardProfiles, profile) }))
      return profile
    },
    async deleteForwardProfile(id: string) {
      await api.deleteForwardProfile(id)
      setData((current) => ({
        ...current,
        forwardProfiles: current.forwardProfiles.filter((profile) => profile.id !== id),
      }))
    },
  }
}
