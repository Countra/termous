import { describe, expect, it } from 'vitest'
import { assignAgentLaunchIntentKey } from './agentLaunchIntent.ts'

describe('Agent 连接引用意图', () => {
  it('引用意图分配 key 后保留精确配置，不携带草稿来源说明', () => {
    const request = {
      source: 'connection_reference' as const, target: { kind: 'new' as const },
      resource_reference: { kind: 'file_profile' as const, file_access_profile_id: 'file-one' },
      source_resource: { file_access_profile_id: 'file-one', file_access_profile_name: '文件', host_id: 'host-one',
        host_name: '主机', ssh_profile_id: 'ssh-one', engine: 'sftp' as const, status: 'ready' as const },
    }
    expect(assignAgentLaunchIntentKey(request, 7)).toEqual({ ...request, key: 7 })
    expect(request).not.toHaveProperty('source_context')
  })
})
