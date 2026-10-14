import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { isMCPToolDetails } from './mcpClientAdapter.ts'
import { isRecord } from './protocol.ts'
import { desktopCleanupGuidance, runtimeDesktopSafetyOutcome } from './runtimeInputSafety.ts'
import { resourceToolNavigation } from './runtimeToolLifecycle.ts'

// 只描述协议内的后续步骤；加载声明不执行操作，也不恢复旧附着或输入授权。
const desktopNavigation: Record<string, { names: string[]; guidance: string }> = {
  'termous.desktops.list': {
    names: ['termous.desktops.get', 'termous.desktops.attach'],
    guidance: 'list 只枚举会话，不会附着。选定已有会话后用 get 复验当前状态和 connection_generation，再用 attach 建立本轮观察入口；重复 list 不会完成 attach。',
  },
  'termous.desktops.connect': {
    names: ['termous.desktops.get', 'termous.desktops.attach'],
    guidance: '连接已登记时用 get 查询同一 session_id，等到就绪后 attach。不得为等待连接而反复 connect。',
  },
  'termous.desktops.get': {
    names: ['termous.desktops.attach'],
    guidance: '会话就绪后可用当前 session_id 与 connection_generation 调用 attach；查询本身不会产生附着。已有有效 attachment_id 时可继续使用，不必重新附着。',
  },
  'termous.desktops.attach': {
    names: ['termous.desktops.get'],
    guidance: '后续使用本次返回的 attachment.id 作为 attachment_id；preparing 时用 get(attachment_id, wait_ms) 等待 ready。观察入口不等于控制授权，不得编造 grant_id。',
  },
  'termous.desktops.control.acquire': {
    names: ['termous.desktops.capture'],
    guidance: '成功授权使用 control.attachment.grant.id。只发现任务需要的精确输入工具；启动 workflow 前先归还自己的直接输入授权，workflow 会申请独立授权。人工收回后不得自动抢回。',
  },
  'termous.desktops.control.release': {
    names: [],
    guidance: '这次操作仅归还控制权，不会申请控制。确需新的输入授权时先发现 termous.desktops.control.acquire；不得将 release 作为申请控制的替代工具。',
  },
}

export function runtimeToolNavigation(name: string, result: AgentToolResult<unknown>) {
  if (!isMCPToolDetails(result.details)) return undefined
  const response = result.details.result
  const safety = runtimeDesktopSafetyOutcome(name, result, response.isError === true)
  if (safety.cleanupUncertain && !safety.inputUncertain) return {
    names: ['termous.desktops.get', 'termous.desktops.capture'], guidance: desktopCleanupGuidance,
  }
  if (response.isError) {
    const error = isRecord(response.structuredContent) ? response.structuredContent.error : undefined
    if (name.startsWith('termous.desktops.') && isRecord(error) && error.code === 'desktop_generation_stale') {
      return {
        names: ['termous.desktops.get', 'termous.desktops.attach'],
        guidance: '旧附着或连接代次已失效。先用 get 复验本轮目标；仅在当前绑定允许且连接代次有效时重新 attach。旧 grant_id、截图引用和未确认输入不得重用或自动重放。',
      }
    }
    if (name.startsWith('termous.desktops.') && isRecord(error) && error.code === 'desktop_control_stale') {
      return { names: ['termous.desktops.get'], guidance: '本次授权已失效或 grant_id 无效；停止沿用该 grant_id。先只读 get 核查自己的附着和当前控制者。申请与归还是不同操作，缺少准确工具时先 discover_tools；不要换请求 ID 重复 release，也不要自动抢回人工收回的控制。' }
    }
    return undefined
  }
  const data = isRecord(response.structuredContent) ? response.structuredContent : undefined
  if ((name === 'termous.desktops.attach' || name === 'termous.desktops.get') && isRecord(data?.attachment)) {
    if (data.attachment.state !== 'ready') return desktopNavigation['termous.desktops.attach']
    return {
      names: ['termous.desktops.capture', ...(!data.attachment.grant ? ['termous.desktops.control.acquire'] : [])],
      guidance: '附着已 ready。观察用 capture；需要键鼠输入时用 control.acquire 申请控制，成功后使用返回的真实 grant.id。release 只归还已有授权，不能申请控制。若准确工具不在声明中，先精确 discover_tools，不能用相似工具或占位 ID 代替。',
    }
  }
  return desktopNavigation[name] ?? resourceToolNavigation(name, data)
}
