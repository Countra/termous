import { projectAgentSessions } from './agentWorkspaceProjection.ts'

export function createAgentSessionProjector() {
  let previous: ReturnType<typeof projectAgentSessions> = []
  return (...args: Parameters<typeof projectAgentSessions>) => {
    const byId = new Map(previous.map(session => [session.id, session]))
    const result = projectAgentSessions(...args).map(session => {
      const old = byId.get(session.id)
      // Run 的用量、水位更新不改变侧栏内容；仅保留当前会话列表的展示投影。
      return old && (Object.keys(session) as Array<keyof typeof session>).every(key => old[key] === session[key]) ? old : session
    })
    if (result.length === previous.length && result.every((session, index) => session === previous[index])) return previous
    previous = result
    return result
  }
}
