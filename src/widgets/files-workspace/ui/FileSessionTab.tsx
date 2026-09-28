import { Popover } from 'antd'
import { Bot, CopyPlus, Folder, RefreshCw } from 'lucide-react'
import { startTransition, useEffect, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { connectionReferenceMenuProps, type AgentConnectionReferenceProps } from '#entities/agent'
import type { FileSession } from '#entities/file'
import { HostAvatar, type Host } from '#entities/host'
import { SessionTabButton, SessionTargetDropdown } from '#shared/ui'
import {
  buildSessionTabAppearanceItems,
  SessionTabColorPanel,
  SessionTabMenuItem,
  sessionTabStyles as styles,
  type SessionTabPreference,
} from '#features/session-tabs'

export type FileSessionTabAction = 'duplicate' | 'restart' | 'rename' | 'pin' | 'reset'

interface FileSessionTabProps extends AgentConnectionReferenceProps {
  fileSession: FileSession
  host?: Pick<Host, 'icon_id' | 'name'>
  getHostIconUrl: (iconId: string) => string
  label: string
  active: boolean
  closing: boolean
  busy?: boolean
  preference?: SessionTabPreference
  onMenuAction: (action: FileSessionTabAction) => void
  onColorChange: (color?: string) => void
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
  busy = false,
  preference,
  onMenuAction,
  onColorChange,
  onSelect,
  onAuxClose,
  onClose,
  getAgentConnectionReferenceSnapshot,
  onReferenceAgentConnection,
}: FileSessionTabProps) {
  const { t } = useTranslation()
  const [colorOpen, setColorOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => {
    if (closing) setColorOpen(false)
  }, [closing])
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
    <SessionTargetDropdown disabled={closing}
      onOpenChange={setMenuOpen}
      popupClassName={styles['terminal-tab-dropdown']}
      items={[
        {
          key: 'duplicate',
          disabled: busy || !fileSession.file_access_profile_id,
          label: <SessionTabMenuItem icon={<CopyPlus size={15} />} title={t('terminal.tabMenu.duplicate')} />,
        },
        {
          key: 'restart',
          disabled: busy || !fileSession.file_access_profile_id
            || fileSession.status === 'connecting' || fileSession.status === 'waiting_trust',
          label: <SessionTabMenuItem icon={<RefreshCw size={15} />} title={t('terminal.tabMenu.restart')} />,
        },
        ...buildSessionTabAppearanceItems(preference, t),
      ]}
      onMenuClick={({ key, domEvent }) => {
        domEvent.stopPropagation()
        if (closing) return
        if (key === 'color') setColorOpen(true)
        else {
          setColorOpen(false)
          onMenuAction(key as FileSessionTabAction)
        }
      }}
      {...connectionReferenceMenuProps(fileSession.file_access_profile_id ? { kind: 'file_profile', file_access_profile_id: fileSession.file_access_profile_id } : undefined, { getAgentConnectionReferenceSnapshot, onReferenceAgentConnection })}>
      <span className={styles['session-tab-trigger']}>
        <Popover
          open={colorOpen && !closing}
          destroyOnHidden
          placement="bottomLeft"
          arrow={false}
          trigger="click"
          classNames={{ root: styles['session-tab-color-popover'] }}
          onOpenChange={(open) => { if (!open) setColorOpen(false) }}
          content={(
            <SessionTabColorPanel color={preference?.color}
              onSelect={(color, options) => {
                if (closing) return
                onColorChange(color)
                if (!options?.keepOpen) setColorOpen(false)
              }}
              onReset={() => { if (!closing) onColorChange(); setColorOpen(false) }}
            />
          )}
        >
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
            tooltipDisabled={menuOpen || colorOpen}
            pinned={preference?.pinned}
            pinLabel={t('terminal.tabMenu.pinned')}
            accentColor={preference?.color}
            closeLabel={`${t('app.close')} ${label}`}
            onClose={() => onClose(fileSession.id)}
          />
        </Popover>
      </span>
    </SessionTargetDropdown>
  )
}
