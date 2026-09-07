import { describe, expect, it } from 'vitest'
import { resolveAgentResourceError } from './agentResourceError.ts'

describe('Agent 资源错误投影', () => {
  it('保留不可用原因并拒绝未知原因进入本地化 key', () => {
    expect(resolveAgentResourceError({
      code: 'AGENT_RESOURCE_BINDING_UNAVAILABLE',
      details: { reason: 'core_restarted' },
    })).toEqual({ kind: 'unavailable', reason: 'core_restarted' })
    expect(resolveAgentResourceError({
      code: 'AGENT_RESOURCE_BINDING_UNAVAILABLE',
      details: { reason: 'server_message' },
    })).toEqual({ kind: 'unavailable', reason: 'unknown' })
  })

  it('区分服务端 revision 与 active run 冲突合同', () => {
    expect(resolveAgentResourceError({ code: 'AGENT_REVISION_CONFLICT' }))
      .toEqual({ kind: 'revision_conflict' })
    expect(resolveAgentResourceError({ code: 'AGENT_RUN_CONFLICT' }))
      .toEqual({ kind: 'run_conflict' })
    expect(resolveAgentResourceError({ code: 'AGENT_SESSION_CONFLICT' }))
      .toEqual({ kind: 'generic' })
  })
})
