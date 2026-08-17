import { Bot, Folder } from 'lucide-react'
import { startTransition, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileSession } from '#entities/file'
import { HostAvatar, type Host } from '#entities/host'
import { SessionTabButton } from '#shared/ui'

interface FileSessionTabProps {
  fileSession: FileSession
  host?: Pick<Host, 'icon_id' | 'name'>
  getHostIconUrl: (iconId: string) => string
  label: string
  active: boolean
  closing: boolean
  onSelect: (fileSessionId: string) => void
  onAuxClose: (event: MouseEvent<HTMLElement>, fileSessionId: string) => void
  onClose: (fileSessionId: string) => void
}

export function FileSessionTab({
  fileSession,
  host,
  getHostIconUrl,
  label,
  active,
  closing,
  onSelect,
  onAuxClose,
  onClose,
}: FileSessionTabProps) {
  const { t } = useTranslation()
  const statusLabel = t(`files.sessionStatus.${fileSession.status}`)
  const closingLabel = t('files.sessionStatus.closing')
  const isMcpSession = fileSession.origin === 'mcp'
  const originLabel = t('sessionOrigin.mcp')
  const defaultIcon = <Folder size={18} />
  const sessionIcon = host?.icon_id?.trim() ? (
    <HostAvatar
      host={host}
      getIconUrl={getHostIconUrl}
      size={18}
      compact
      fallbackIcon={defaultIcon}
    />
  ) : defaultIcon
  const accessibleLabel = isMcpSession
    ? `${label} · ${originLabel} · ${closing ? closingLabel : statusLabel}`
    : undefined
  const tooltipTitle = isMcpSession
    ? (closing ? `${label} · ${originLabel}` : accessibleLabel)
    : undefined

  return (
    <SessionTabButton
      active={active}
      role="tab"
      aria-selected={active}
      aria-label={accessibleLabel}
      data-session-tab-id={fileSession.id}
      data-session-origin={isMcpSession ? 'mcp' : undefined}
      onClick={() => {
        if (!closing) {
          startTransition(() => onSelect(fileSession.id))
        }
      }}
      onMouseDown={(event) => {
        if (event.button === 1) {
          event.preventDefault()
        }
      }}
      onAuxClick={(event) => onAuxClose(event, fileSession.id)}
      icon={sessionIcon}
      sourceIndicator={isMcpSession ? <Bot size={12} strokeWidth={2} /> : undefined}
      label={label}
      status={fileSession.status}
      statusLabel={statusLabel}
      closing={closing}
      closingLabel={closingLabel}
      tooltipTitle={tooltipTitle}
      closeLabel={`${t('app.close')} ${label}`}
      onClose={() => onClose(fileSession.id)}
    />
  )
}
