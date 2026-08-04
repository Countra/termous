import { useEffect, useState } from 'react'
import type { TermousApi } from '../../api/client'
import type { AliasSyncTask } from '../../types/domain'
import { isAliasSyncTaskTerminal } from './aliasSyncTaskState'

interface UseAliasSyncActiveIndicatorOptions {
  api: TermousApi
  enabled: boolean
}

const ACTIVE_SYNC_REFRESH_INTERVAL = 2_500

export function useAliasSyncActiveIndicator({
  api,
  enabled,
}: UseAliasSyncActiveIndicatorOptions) {
  const [task, setTask] = useState<AliasSyncTask | null>(null)

  useEffect(() => {
    if (!enabled) {
      setTask(null)
      return undefined
    }

    let disposed = false
    let timer = 0
    let controller: AbortController | null = null

    const scheduleRefresh = () => {
      if (disposed) {
        return
      }
      timer = window.setTimeout(loadActiveTask, ACTIVE_SYNC_REFRESH_INTERVAL)
    }

    async function loadActiveTask() {
      controller = new AbortController()
      try {
        const activeTask = await api.activeAliasSyncTask({ signal: controller.signal })
        if (!disposed) {
          setTask(activeTask && !isAliasSyncTaskTerminal(activeTask.status) ? activeTask : null)
        }
      } catch {
        // 短暂请求失败时保留上次状态，下个周期继续通过 active API 对账。
      } finally {
        scheduleRefresh()
      }
    }

    void loadActiveTask()

    return () => {
      disposed = true
      if (timer) {
        window.clearTimeout(timer)
      }
      controller?.abort()
    }
  }, [api, enabled])

  return task
}
