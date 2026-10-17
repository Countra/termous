import { useTranslation } from 'react-i18next'
import { DetachedWindowButton } from '#shared/ui'

export function AgentWindowButton({ returning = false, busy = false, onClick }: { returning?: boolean; busy?: boolean; onClick: () => void }) {
  const { t } = useTranslation()
  const label = t(returning ? 'agent.window.return' : 'agent.window.open')
  return <DetachedWindowButton label={label} returning={returning} busy={busy} onClick={onClick} />
}
