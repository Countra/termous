import { useCallback, useEffect, useState } from 'react'
import type { AgentDefaultModelStatusGateway, AgentDefaultModelStatusView } from './agentDefaultModelStatus.ts'

export function useAgentDefaultModelStatus(
  getStatus: AgentDefaultModelStatusGateway['getDefaultModelStatus'] | undefined,
  enabled: boolean,
) {
  const [view, setView] = useState<AgentDefaultModelStatusView>({ status: 'loading' })
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    if (!enabled) return
    if (!getStatus) {
      setView({ status: 'unavailable', reason: 'status_unavailable' })
      return
    }
    const controller = new AbortController()
    setView({ status: 'loading' })
    void Promise.resolve().then(() => getStatus({ signal: controller.signal })).then((result) => {
      if (controller.signal.aborted) return
      setView(result.available
        ? { status: 'ready', label: result.model_name }
        : { status: 'unavailable', label: result.model_name, reason: result.reason })
    }).catch(() => {
      if (!controller.signal.aborted) setView({ status: 'unavailable', reason: 'status_unavailable' })
    })
    // 浮层关闭、切换页面或重新查询后，不接收上一份模型状态回执。
    return () => controller.abort()
  }, [enabled, getStatus, revision])

  return { ...view, refresh }
}
