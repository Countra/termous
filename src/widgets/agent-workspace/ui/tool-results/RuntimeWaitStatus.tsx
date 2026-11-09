import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentRuntimeWait } from '#entities/agent'

export function RuntimeWaitStatus({ wait, running }: { wait: AgentRuntimeWait; running: boolean }) {
  const { t } = useTranslation()
  const [now, setNow] = useState(Date.now)
  const start = Date.parse(wait.startedAt ?? '')
  useEffect(() => {
    if (!running || !Number.isFinite(start)) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [running, start])
  if (wait.wakeReason) return <span>{t(`localTools.waitResult.${wait.wakeReason}`, { seconds: ((wait.elapsedMs ?? 0) / 1000).toFixed(1) })}</span>
  if (!running || !Number.isFinite(start)) return <span>{t('agent.tool.phase.waiting')}</span>
  const remaining = Math.max(0, Math.ceil(wait.seconds - (now - start) / 1000))
  return <span>{t(remaining ? 'localTools.waitRemaining' : 'localTools.waitFinishing', { seconds: remaining })}</span>
}
