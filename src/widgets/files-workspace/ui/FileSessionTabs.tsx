import { App as AntdApp, Input, Modal } from 'antd'
import { Folder } from 'lucide-react'
import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentConnectionReferenceProps } from '#entities/agent'
import type { FileSession, FileSessionConnectInput } from '#entities/file'
import type { FileAccessProfile } from '#entities/file-access-profile'
import type { Host } from '#entities/host'
import {
  normalizeSessionTabTitle,
  sessionTabStyles,
  sortSessionsForTabs,
} from '#features/session-tabs'
import { SessionNewTabButton, SessionTabButton, SessionTabStrip, termousNotificationClassName } from '#shared/ui'
import { useFilesWorkspaceRuntime } from '../model/useFilesWorkspaceRuntime'
import { FileSessionTab, type FileSessionTabAction } from './FileSessionTab'

interface Props extends AgentConnectionReferenceProps {
  sessions: FileSession[]
  hosts: Pick<Host, 'id' | 'name' | 'icon_id'>[]
  profiles?: FileAccessProfile[]
  activeId: string
  closingIds: ReadonlySet<string>
  getHostIconUrl: (id: string) => string
  getPath: (session: FileSession) => string
  onConnect: (input: FileSessionConnectInput) => Promise<FileSession>
  onClose: (id: string) => Promise<boolean>
  onRestart: (session: FileSession, initialPath: string) => Promise<FileSession | null>
  onSelect: (id: string) => void
  onAuxClose: (event: MouseEvent<HTMLElement>, id: string) => void
  onOpenLauncher: () => void
}

export function FileSessionTabs({
  sessions, hosts, profiles, activeId, closingIds, getHostIconUrl, getPath,
  onConnect, onClose, onRestart, onSelect, onAuxClose, onOpenLauncher,
  getAgentConnectionReferenceSnapshot, onReferenceAgentConnection,
}: Props) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const { sessionTabs: actions } = useFilesWorkspaceRuntime()
  const { preferences, update } = actions
  const [rename, setRename] = useState<{ id: string; title: string } | null>(null)
  const sortedSessions = useMemo(() => sortSessionsForTabs(sessions, preferences), [sessions, preferences])

  useEffect(() => {
    if (rename && (!sessions.some((session) => session.id === rename.id) || closingIds.has(rename.id))) {
      setRename(null)
    }
  }, [sessions, closingIds, rename])

  const saveRename = () => {
    if (!rename || closingIds.has(rename.id) || !sessions.some((session) => session.id === rename.id)) return
    update(rename.id, (value) => ({ ...value, title: normalizeSessionTabTitle(rename.title) }))
    setRename(null)
  }

  const handleAction = async (action: FileSessionTabAction, session: FileSession, title: string) => {
    if (closingIds.has(session.id)) return
    switch (action) {
      case 'duplicate':
      case 'restart': {
        if (action === 'restart' && (session.status === 'connecting' || session.status === 'waiting_trust')) return
        try {
          await actions.run(action, session, { initialPath: getPath(session), onConnect, onRestart })
        } catch (error) {
          notification.error({
            title: t(`files.tabMenu.${action}Failed`),
            description: error instanceof Error ? error.message : t('app.error'),
            className: termousNotificationClassName,
            duration: 5,
            role: 'alert',
          })
        }
        break
      }
      case 'rename': setRename({ id: session.id, title }); break
      case 'pin':
        update(session.id, (value) => ({ ...value, pinned: !value.pinned, pinnedAt: value.pinned ? undefined : Date.now() }))
        break
      case 'reset': update(session.id, () => ({})); break
    }
  }

  return (
    <>
      <SessionTabStrip
        ariaLabel={t('files.sessions')}
        activeId={activeId}
        contentKey={sortedSessions.map((session) => session.id).join('|')}
        scrollLeftLabel={t('workbench.scrollTabsLeft')}
        scrollRightLabel={t('workbench.scrollTabsRight')}
        tabsClassName={`${sessionTabStyles['terminal-tabs']} terminal-tabs`}
        trailing={<SessionNewTabButton label={t('files.openFileSession')} onClick={onOpenLauncher} />}
      >
        {sortedSessions.length === 0 ? (
          <SessionTabButton empty icon={<Folder size={18} />} label={t('app.noSessions')} />
        ) : sortedSessions.map((session) => {
          const host = hosts.find((item) => item.id === session.host_id)
          const profile = profiles?.find((item) => item.id === session.file_access_profile_id)
          const preference = preferences[session.id]
          const title = preference?.title ?? profile?.name ?? host?.name ?? session.id.slice(0, 8)
          return (
            <FileSessionTab key={session.id} fileSession={session} host={host}
              getHostIconUrl={getHostIconUrl} label={title} preference={preference}
              active={session.id === activeId} closing={closingIds.has(session.id)}
              busy={actions.pendingIds.has(session.id)}
              onSelect={onSelect} onAuxClose={onAuxClose} onClose={(id) => { void onClose(id) }}
              onMenuAction={(action) => { void handleAction(action, session, title) }}
              onColorChange={(color) => update(session.id, (value) => ({ ...value, color }))}
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
        <Input id="files-session-rename" name="files-session-rename" maxLength={80} autoFocus
          aria-label={t('terminal.tabMenu.renameTitle')}
          placeholder={t('terminal.tabMenu.renamePlaceholder')} value={rename?.title ?? ''}
          onChange={(event) => setRename((value) => value ? { ...value, title: event.target.value } : null)}
          onPressEnter={saveRename}
        />
      </Modal>
    </>
  )
}
