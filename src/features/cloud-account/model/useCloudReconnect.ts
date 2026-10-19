import { useEffect } from 'react'
import { isCloudConnectionError, type CloudGateway } from '#entities/cloud'

// 以 Core 的连接状态为准；浏览器 online 事件不能代表云服务已恢复。
export function useCloudReconnect(api: CloudGateway, generation: string, refresh: () => void) {
  useEffect(() => {
    let disconnected = false
    const observe = () => {
      const status = api.getStatus()
      if (!status?.authenticated || status.generation !== generation) {
        disconnected = false
        return
      }
      if (isCloudConnectionError(status.error_code)) disconnected = true
      if (disconnected && status.phase === 'ready' && !status.error_code) {
        disconnected = false
        refresh()
      }
    }
    const unsubscribe = api.subscribeStatus(observe)
    observe()
    const resume = () => {
      if (document.visibilityState === 'visible' && api.getStatus()?.generation === generation && api.getStatus()?.authenticated) refresh()
    }
    window.addEventListener('focus', resume)
    document.addEventListener('visibilitychange', resume)
    return () => { unsubscribe(); window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume) }
  }, [api, generation, refresh])
}
