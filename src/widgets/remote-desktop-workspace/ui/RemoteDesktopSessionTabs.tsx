import { App as AntdApp, Input, Modal } from 'antd'
import { MonitorPlay } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentConnectionReferenceProps } from '#entities/agent'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import { useRemoteDesktopRuntime } from '#features/remote-desktop'
import {
  normalizeSessionTabTitle,
  sortSessionsForTabs,
  useSessionTabPreferences,
} from '#features/session-tabs'
import { SessionNewTabButton, SessionTabButton, SessionTabStrip, termousNotificationClassName } from '#shared/ui'
import { RemoteDesktopSessionTab, type RemoteDesktopTabAction } from './RemoteDesktopSessionTab'
import styles from './RemoteDesktopWorkspace.module.scss'

export const remoteDesktopTabPreferencesKey = 'termous.ui.remoteDesktop.sessionTabPreferences.v1'

interface Props extends AgentConnectionReferenceProps {
  onOpenLauncher?: () => void
  onClose: (session: RemoteDesktopSession) => void
}

export function RemoteDesktopSessionTabs({
  onOpenLauncher, onClose, getAgentConnectionReferenceSnapshot, onReferenceAgentConnection,
}: Props) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const runtime = useRemoteDesktopRuntime()
  // 启动前的空列表尚无权威含义，不能据此清理持久化外观。
  const { preferences, update } = useSessionTabPreferences(remoteDesktopTabPreferencesKey, runtime.sessionsReady ? runtime.sessions : undefined)
  const [rename, setRename] = useState<{ id: string; title: string } | null>(null)
  const visibleSessions = useMemo(() => sortSessionsForTabs(
    runtime.sessions.filter((session) => !runtime.hiddenSessionIds.includes(session.id)), preferences,
  ), [runtime.sessions, runtime.hiddenSessionIds, preferences])

  useEffect(() => {
    if (rename && !visibleSessions.some((session) => session.id === rename.id && session.status !== 'stopping')) {
      setRename(null)
    }
  }, [rename, visibleSessions])

  const saveRename = () => {
    if (!rename || !visibleSessions.some((session) => session.id === rename.id && session.status !== 'stopping')) return
    update(rename.id, (value) => ({ ...value, title: normalizeSessionTabTitle(rename.title) }))
    setRename(null)
  }

  const handleAction = async (action: RemoteDesktopTabAction, session: RemoteDesktopSession, title: string) => {
    if (session.status === 'stopping') return
    switch (action) {
      case 'duplicate':
      case 'restart':
        if (runtime.pendingSessionActionIds.has(session.id)) return
        if (action === 'restart' && reconnectBlocked(session)) return
        try {
          if (action === 'duplicate') await runtime.duplicateSession(session.id)
          else await runtime.reconnectSession(session.id)
        } catch (error) {
          notification.error({
            title: t(action === 'duplicate' ? 'remoteDesktop.duplicateFailed' : 'remoteDesktop.reconnectFailed'),
            description: error instanceof Error ? error.message : t('app.error'),
            className: termousNotificationClassName,
          })
        }
        break
      case 'rename': setRename({ id: session.id, title }); break
      case 'pin':
        update(session.id, (value) => ({ ...value, pinned: !value.pinned, pinnedAt: value.pinned ? undefined : Date.now() }))
        break
      case 'reset': update(session.id, () => ({})); break
    }
  }

  return (
    <>
      <SessionTabStrip ariaLabel={t('remoteDesktop.sessions')} activeId={runtime.activeSessionId ?? undefined}
        contentKey={visibleSessions.map((session) => `${session.id}:${session.status}`).join('|')}
        scrollLeftLabel={t('remoteDesktop.scrollTabsLeft')} scrollRightLabel={t('remoteDesktop.scrollTabsRight')}
        tabsClassName={styles['session-tabs']}
        trailing={onOpenLauncher ? <SessionNewTabButton label={t('remoteDesktop.newConnection')} onClick={onOpenLauncher} /> : undefined}
      >
        {visibleSessions.length === 0 ? (
          <SessionTabButton empty icon={<MonitorPlay size={18} />} label={t('app.noSessions')} />
        ) : visibleSessions.map((session) => {
          const preference = preferences[session.id]
          const title = preference?.title ?? session.profile_name
          const closing = session.status === 'stopping'
          const busy = runtime.pendingSessionActionIds.has(session.id)
          return (
            <RemoteDesktopSessionTab key={session.id} session={session} label={title}
              active={session.id === runtime.activeSessionId} closing={closing} preference={preference}
              duplicateDisabled={busy || session.protocol !== 'vnc' || !session.profile_id || Boolean(session.automation_host_id)}
              restartDisabled={busy || reconnectBlocked(session)}
              onAction={(action) => { void handleAction(action, session, title) }}
              onColorChange={(color) => update(session.id, (value) => ({ ...value, color }))}
              onSelect={() => runtime.selectSession(session.id)}
              onClose={() => session.protocol === 'rdp' ? runtime.closeViewer(session.id) : onClose(session)}
              getAgentConnectionReferenceSnapshot={getAgentConnectionReferenceSnapshot}
              onReferenceAgentConnection={onReferenceAgentConnection}
            />
          )
        })}
      </SessionTabStrip>
      <Modal open={Boolean(rename)} title={t('terminal.tabMenu.renameTitle')}
        okText={t('app.confirm')} cancelText={t('app.cancel')} centered className="termous-modal"
        onOk={saveRename} onCancel={() => setRename(null)}
      >
        <Input id="desktop-session-rename" name="desktop-session-rename" maxLength={80} autoFocus
          aria-label={t('terminal.tabMenu.renameTitle')} placeholder={t('terminal.tabMenu.renamePlaceholder')}
          value={rename?.title ?? ''}
          onChange={(event) => setRename((value) => value ? { ...value, title: event.target.value } : null)}
          onPressEnter={saveRename}
        />
      </Modal>
    </>
  )
}

function reconnectBlocked(session: RemoteDesktopSession) {
  return ['connecting', 'waiting_host_trust', 'reconnecting', 'stopping'].includes(session.status)
}
