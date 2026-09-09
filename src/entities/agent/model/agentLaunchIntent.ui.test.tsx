import { describe, expect, it } from 'vitest'
import {
  assignAgentLaunchIntentKey,
  buildForwardFailureAgentLaunchRequest,
  buildHostProfileAgentLaunchRequest,
} from './agentLaunchIntent.ts'

describe('Agent 业务来源意图', () => {
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

  it('主机和 Profile 使用明确的稳定实体 ID', () => {
    expect(buildHostProfileAgentLaunchRequest({
      hostId: 'hst_a',
      profileKind: 'remote_desktop',
      profileId: 'rdp_a',
      title: '桌面连接',
      summary: 'VNC Profile',
    }).source_context.entity_id).toBe('rdp_a')
  })

  it('转发失败仅保留稳定错误码，不携带错误原文', () => {
    const request = buildForwardFailureAgentLaunchRequest({
      hostId: 'hst_a',
      forwardId: 'fwd_a',
      status: 'failed',
      errorCode: 'FORWARD_DIAL_FAILED',
      title: '端口转发失败',
      summary: '状态：失败',
    })

    expect(request).toMatchObject({
      source: 'forward_failure',
      forward_id: 'fwd_a',
      error_code: 'FORWARD_DIAL_FAILED',
    })
    expect(request).not.toHaveProperty('error_message')
  })
})
