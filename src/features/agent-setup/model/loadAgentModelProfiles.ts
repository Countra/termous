import type { AgentModelProfile, AgentModelProfilePage } from '#entities/agent'

const maximumModelProfiles = 32

export interface AgentModelProfilePageSource {
  modelProfiles(cursor?: string, signal?: AbortSignal): Promise<AgentModelProfilePage>
}

export async function loadAllAgentModelProfiles(
  source: AgentModelProfilePageSource,
  signal?: AbortSignal,
) {
  const profiles: AgentModelProfile[] = []
  const cursors = new Set<string>()
  const profileIds = new Set<string>()
  let cursor: string | undefined
  for (let pageIndex = 0; pageIndex < maximumModelProfiles; pageIndex += 1) {
    const page = await source.modelProfiles(cursor, signal)
    for (const profile of page.items) {
      if (profileIds.has(profile.id) || profiles.length >= maximumModelProfiles) {
        throw new Error('Agent model profile pagination is invalid')
      }
      profileIds.add(profile.id)
      profiles.push(profile)
    }
    if (!page.next_cursor) return profiles
    if (cursors.has(page.next_cursor)) {
      throw new Error('Agent model profile pagination is invalid')
    }
    cursors.add(page.next_cursor)
    cursor = page.next_cursor
  }
  throw new Error('Agent model profile pagination is invalid')
}
