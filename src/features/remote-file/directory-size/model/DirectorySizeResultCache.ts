import type { RemoteDirectorySize } from '#entities/file'
import type { DirectorySizeSource } from './types.ts'

export const directorySizeResultCacheLimit = 30

export interface DirectorySizeCacheSession {
  id: string
  connectionGeneration: number
  closing: boolean
}

interface DirectorySizeCacheEntry {
  path: string
  result: RemoteDirectorySize
}

interface DirectorySizeSessionCache {
  connectionGeneration: number
  entries: DirectorySizeCacheEntry[]
}

export class DirectorySizeResultCache {
  private readonly sessions = new Map<string, DirectorySizeSessionCache>()

  peek(source: DirectorySizeSource) {
    const session = this.sessions.get(source.fileSessionId)
    if (!session || session.connectionGeneration !== source.connectionGeneration) {
      return undefined
    }
    return session.entries.find((entry) => entry.path === source.path)?.result
  }

  get(source: DirectorySizeSource) {
    const session = this.sessions.get(source.fileSessionId)
    if (!session) {
      return undefined
    }
    if (session.connectionGeneration !== source.connectionGeneration) {
      if (source.connectionGeneration > session.connectionGeneration) {
        this.sessions.delete(source.fileSessionId)
      }
      return undefined
    }

    const index = session.entries.findIndex((entry) => entry.path === source.path)
    if (index < 0) {
      return undefined
    }
    const [entry] = session.entries.splice(index, 1)
    session.entries.unshift(entry)
    return entry.result
  }

  set(source: DirectorySizeSource, result: RemoteDirectorySize) {
    let session = this.sessions.get(source.fileSessionId)
    if (session && source.connectionGeneration < session.connectionGeneration) {
      return
    }
    if (!session || session.connectionGeneration !== source.connectionGeneration) {
      session = {
        connectionGeneration: source.connectionGeneration,
        entries: [],
      }
      this.sessions.set(source.fileSessionId, session)
    }

    const existingIndex = session.entries.findIndex((entry) => entry.path === source.path)
    if (existingIndex >= 0) {
      session.entries.splice(existingIndex, 1)
    }
    session.entries.unshift({ path: source.path, result })
    if (session.entries.length > directorySizeResultCacheLimit) {
      session.entries.pop()
    }
  }

  clearSession(fileSessionId: string) {
    this.sessions.delete(fileSessionId)
  }

  retainSessions(sessions: readonly DirectorySizeCacheSession[]) {
    const retained = new Map<string, number>()
    sessions.forEach((session) => {
      if (!session.closing) {
        retained.set(session.id, session.connectionGeneration)
      }
    })
    this.sessions.forEach((session, fileSessionId) => {
      if (retained.get(fileSessionId) !== session.connectionGeneration) {
        this.sessions.delete(fileSessionId)
      }
    })
  }
}
