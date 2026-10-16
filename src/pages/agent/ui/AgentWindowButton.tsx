import { Button, Tooltip } from 'antd'
import { AppWindow, CornerDownLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function AgentWindowButton({ returning = false, busy = false, onClick }: { returning?: boolean; busy?: boolean; onClick: () => void }) {
  const { t } = useTranslation()
  const label = t(returning ? 'agent.window.return' : 'agent.window.open')
  return <Tooltip title={label}><Button type="text" aria-label={label} loading={busy} disabled={busy}
    icon={returning ? <CornerDownLeft size={16} /> : <AppWindow size={16} />} onClick={onClick} /></Tooltip>
}
