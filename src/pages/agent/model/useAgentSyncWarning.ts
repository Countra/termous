import { useEffect, useState } from 'react'

// 延迟的仅是可自动恢复的读取提示；权限拒绝、协议错误和用户写操作始终立即反馈。
export function useAgentSyncWarning(issue: string | undefined, deferred: boolean) {
  const pending = Boolean(issue && deferred)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!pending) { setVisible(false); return }
    // 连续失败期间即使错误码变化，也不能重新开始宽限期而永久隐藏故障。
    const timer = setTimeout(() => setVisible(true), 2000)
    return () => clearTimeout(timer)
  }, [pending])
  return Boolean(issue && (!deferred || visible))
}
