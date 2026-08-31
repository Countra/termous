import { describe, expect, it } from 'vitest'
import {
  assignAgentLaunchIntentKey,
  buildFilesAgentLaunchRequest,
  buildForwardFailureAgentLaunchRequest,
  buildHostProfileAgentLaunchRequest,
  buildWorkbenchAgentLaunchRequest,
} from './agentLaunchIntent.ts'

describe('Agent 业务来源意图', () => {
  it('为联合意图分配单调 key 时保持来源字段', () => {
    const request = buildWorkbenchAgentLaunchRequest({
      sessionId: 'ses_a',
      hostId: 'hst_a',
      sshProfileId: 'sap_a',
      connectionStatus: 'connected',
      title: '生产主机',
      summary: 'SSH 已连接',
    })

    expect(assignAgentLaunchIntentKey(request, 7)).toEqual({ ...request, key: 7 })
  })

  it('工作站同时投影展示上下文与精确 SSH Session 引用', () => {
    expect(buildWorkbenchAgentLaunchRequest({
      sessionId: 'ses_a',
      hostId: 'hst_a',
      sshProfileId: 'sap_a',
      connectionStatus: 'connected',
      title: '生产主机',
      summary: 'SSH 已连接',
    })).toEqual({
      source: 'workbench',
      host_id: 'hst_a',
      ssh_profile_id: 'sap_a',
      connection_status: 'connected',
      resource_reference: { kind: 'ssh_session', session_id: 'ses_a' },
      source_context: {
        kind: 'workbench',
        entity_id: 'sap_a',
        title: '生产主机',
        summary: 'SSH 已连接',
      },
    })
  })

  it('文件入口不携带 Renderer Session 或当前路径', () => {
    const request = buildFilesAgentLaunchRequest({
      hostId: 'hst_a',
      fileAccessProfileId: 'fap_a',
      connectionStatus: 'connected',
      title: '生产文件',
      summary: 'SFTP 已连接',
    })

    expect(request).toMatchObject({
      source: 'files',
      host_id: 'hst_a',
      file_access_profile_id: 'fap_a',
      connection_status: 'connected',
    })
    expect(request).not.toHaveProperty('file_session_id')
    expect(request).not.toHaveProperty('path')
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
