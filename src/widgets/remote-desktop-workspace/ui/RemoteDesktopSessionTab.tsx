import { Popover } from 'antd'
import { CopyPlus, MonitorPlay, Palette, Pencil, Pin, PinOff, RefreshCw, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { connectionReferenceMenuProps, type AgentConnectionReferenceProps } from '#entities/agent'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import { SessionTabColorPanel, SessionTabMenuItem, sessionTabStyles as styles, type SessionTabPreference } from '#features/session-tabs'
import { SessionTabButton, SessionTargetDropdown } from '#shared/ui'

export type RemoteDesktopTabAction = 'duplicate' | 'restart' | 'rename' | 'pin' | 'reset'

interface Props extends AgentConnectionReferenceProps {
  session: RemoteDesktopSession
  label: string
  active: boolean
  closing: boolean
  preference?: SessionTabPreference
  duplicateDisabled: boolean
  restartDisabled: boolean
  onAction: (action: RemoteDesktopTabAction) => void
  onColorChange: (color?: string) => void
  onSelect: () => void
  onClose: () => void
}

export function RemoteDesktopSessionTab({
  session, label, active, closing, preference, duplicateDisabled, restartDisabled,
  onAction, onColorChange, onSelect, onClose, getAgentConnectionReferenceSnapshot, onReferenceAgentConnection,
}: Props) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [colorOpen, setColorOpen] = useState(false)
  useEffect(() => { if (closing) setColorOpen(false) }, [closing])

  return (
    <SessionTargetDropdown disabled={closing} onOpenChange={setMenuOpen}
      popupClassName={styles['terminal-tab-dropdown']}
      items={[
        { key: 'duplicate', disabled: duplicateDisabled,
          label: <SessionTabMenuItem icon={<CopyPlus size={15} />} title={t('terminal.tabMenu.duplicate')} /> },
        { key: 'restart', disabled: restartDisabled,
          label: <SessionTabMenuItem icon={<RefreshCw size={15} />} title={t('terminal.tabMenu.restart')} /> },
        { key: 'rename', label: <SessionTabMenuItem icon={<Pencil size={15} />} title={t('terminal.tabMenu.rename')} /> },
        { key: 'pin', label: <SessionTabMenuItem icon={preference?.pinned ? <PinOff size={15} /> : <Pin size={15} />}
          title={t(preference?.pinned ? 'terminal.tabMenu.unpin' : 'terminal.tabMenu.pin')} /> },
        { key: 'color', label: <SessionTabMenuItem icon={<Palette size={15} />} title={t('terminal.tabMenu.color')} /> },
        { key: 'reset', disabled: !preference,
          label: <SessionTabMenuItem icon={<RotateCcw size={15} />} title={t('terminal.tabMenu.reset')} /> },
      ]}
      onMenuClick={({ key, domEvent }) => {
        domEvent.stopPropagation()
        if (closing) return
        if (key === 'color') setColorOpen(true)
        else {
          setColorOpen(false)
          if (key === 'duplicate' || key === 'restart' || key === 'rename' || key === 'pin' || key === 'reset') onAction(key)
        }
      }}
      {...connectionReferenceMenuProps({ kind: 'desktop_session', session_id: session.id, connection_generation: session.connection_generation }, { getAgentConnectionReferenceSnapshot, onReferenceAgentConnection })}
    >
      <span className={styles['session-tab-trigger']}>
        <Popover open={colorOpen && !closing} destroyOnHidden placement="bottomLeft" arrow={false} trigger="click"
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
          <SessionTabButton data-session-tab-id={session.id} active={active} role="tab" aria-selected={active}
            icon={<MonitorPlay size={16} />} label={label} status={tabStatus(session)}
            statusLabel={session.automation ? t('remoteDesktop.automation.active') : t(`remoteDesktop.status.${session.status}`)}
            closing={closing} closingLabel={t('remoteDesktop.status.stopping')}
            pinned={preference?.pinned} pinLabel={t('terminal.tabMenu.pinned')} accentColor={preference?.color}
            closeLabel={t(session.protocol === 'rdp' ? 'remoteDesktop.rdp.closeViewer' : 'remoteDesktop.disconnect')}
            tooltipTitle={`${label} · ${session.host_name}`} tooltipDisabled={menuOpen || colorOpen}
            onClick={() => { if (!closing) onSelect() }} onClose={onClose}
          />
        </Popover>
      </span>
    </SessionTargetDropdown>
  )
}

function tabStatus(session: RemoteDesktopSession) {
  if (session.status === 'streaming' || session.status === 'ready') return 'connected'
  if (session.status === 'waiting_host_trust') return 'waiting_host_trust'
  if (session.status === 'failed') return 'failed'
  if (session.status === 'stopping') return 'closing'
  return 'connecting'
}
