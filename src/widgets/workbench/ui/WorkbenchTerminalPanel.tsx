import { Drawer } from 'antd'
import { Cable, ChevronDown, ChevronUp, SquareTerminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ComponentProps, ReactNode, RefObject } from 'react'
import {
  ConnectionProgress,
  TerminalSearchPanel,
  TerminalSplitWorkspace,
  type TerminalDragPoint,
  type TerminalSplitWorkspaceHandle,
} from '#features/terminal'
import {
  ConnectionActionButton,
  StatusBadge,
  WorkspaceEmptyState as WorkbenchEmptyState,
} from '#shared/ui'
import type { AppTheme as ThemeMode } from '#common/contracts'
import type { Session } from '#entities/session'
import type { WorkbenchTerminalSearchState } from '../model/workbenchTerminalTypes'
import styles from './WorkbenchPage.module.scss'

interface WorkbenchTerminalPanelProps {
  sessionTabs: ReactNode
  commandDock: ReactNode
  commandDockOpen: boolean
  commandTaskActive: boolean
  commandTargetCount: number
  sessions: Session[]
  activeSession: Session | null
  workspaceActive: boolean
  themeMode: ThemeMode
  terminalSplitRef: RefObject<TerminalSplitWorkspaceHandle | null>
  sessionBadgeStatus: ComponentProps<typeof StatusBadge>['status']
  sessionStatusLabel: string
  hasConnectionProgress: boolean
  showRecentConnectionProgress: boolean
  selectedHostAvailable: boolean
  actionBusy: boolean
  dragSessionId: string | null
  dragPoint: TerminalDragPoint | null
  search: WorkbenchTerminalSearchState
  sessionPositionLabel: string
  targetLabel: string
  sessionStateLabel: string
  startedAt: string
  sessionDuration: string
  terminalSize: { cols: number; rows: number }
  onOpenConnectionLauncher: () => void
  onSearchQueryChange: (query: string) => void
  onSearchPrevious: () => void
  onSearchNext: () => void
  onToggleSearchCase: () => void
  onToggleSearchRegex: () => void
  onCloseSearch: () => void
  onSelectSession: (sessionId: string) => void
  onResize: (cols: number, rows: number) => void
  onReconnectSession: (session: Session) => Promise<void>
  onSearchSession: (sessionId: string, initialQuery?: string) => void
  onOpenFilesAtPath: (session: Session, path: string) => void
  onCloseSession: (sessionId: string) => Promise<boolean>
  onToggleCommandDock: () => void
}

export function WorkbenchTerminalPanel({
  sessionTabs,
  commandDock,
  commandDockOpen,
  commandTaskActive,
  commandTargetCount,
  sessions,
  activeSession,
  workspaceActive,
  themeMode,
  terminalSplitRef,
  sessionBadgeStatus,
  sessionStatusLabel,
  hasConnectionProgress,
  showRecentConnectionProgress,
  selectedHostAvailable,
  actionBusy,
  dragSessionId,
  dragPoint,
  search,
  sessionPositionLabel,
  targetLabel,
  sessionStateLabel,
  startedAt,
  sessionDuration,
  terminalSize,
  onOpenConnectionLauncher,
  onSearchQueryChange,
  onSearchPrevious,
  onSearchNext,
  onToggleSearchCase,
  onToggleSearchRegex,
  onCloseSearch,
  onSelectSession,
  onResize,
  onReconnectSession,
  onSearchSession,
  onOpenFilesAtPath,
  onCloseSession,
  onToggleCommandDock,
}: WorkbenchTerminalPanelProps) {
  const { t } = useTranslation()
  return (
    <div className={styles['terminal-workspace']}>
      <div className={styles['terminal-card']}>
        <div className={`${styles['terminal-toolbar']} terminal-toolbar`}>
          {sessionTabs}
          <StatusBadge
            className={styles['terminal-toolbar-status']}
            status={sessionBadgeStatus}
            label={sessionStatusLabel}
          />
        </div>
        <div className={[
          styles['terminal-progress-slot'],
          hasConnectionProgress ? styles['is-active'] : '',
        ].filter(Boolean).join(' ')}>
          <ConnectionProgress session={activeSession} showReady={showRecentConnectionProgress} />
        </div>
        <TerminalSplitWorkspace
          ref={terminalSplitRef}
          sessions={sessions}
          activeSession={activeSession}
          workspaceActive={workspaceActive}
          themeMode={themeMode}
          placeholder={selectedHostAvailable ? t('workbench.terminalReady') : t('workbench.terminalHint')}
          emptyState={sessions.length === 0 ? (
            <WorkbenchEmptyState
              className={styles['terminal-empty-connect']}
              icon={<SquareTerminal size={20} aria-hidden="true" />}
              title={t('workbench.emptyTerminalTitle')}
              description={t('workbench.emptyTerminalHint')}
              action={(
                <ConnectionActionButton
                  className={styles['terminal-empty-connect-button']}
                  icon={<Cable size={16} aria-hidden="true" />}
                  disabled={actionBusy}
                  onClick={onOpenConnectionLauncher}
                >
                  {t('workbench.connectHost')}
                </ConnectionActionButton>
              )}
            />
          ) : undefined}
          actionBusy={actionBusy}
          dragSessionId={dragSessionId}
          dragPoint={dragPoint}
          searchPanel={
            search.open && search.sessionId === activeSession?.id ? (
              <TerminalSearchPanel
                value={search.query}
                caseSensitive={search.caseSensitive}
                regex={search.regex}
                result={search.result}
                onChange={onSearchQueryChange}
                onPrevious={onSearchPrevious}
                onNext={onSearchNext}
                onToggleCase={onToggleSearchCase}
                onToggleRegex={onToggleSearchRegex}
                onClose={onCloseSearch}
              />
            ) : null
          }
          onSelectSession={onSelectSession}
          onResize={onResize}
          onReconnectSession={(session) => void onReconnectSession(session)}
          onSearchSession={onSearchSession}
          onOpenFilesAtPath={onOpenFilesAtPath}
          onCloseSession={(session) => void onCloseSession(session.id)}
        />
        <div
          className={[
            styles['terminal-command-dock-slot'],
            commandDockOpen ? styles['is-open'] : '',
          ].filter(Boolean).join(' ')}
        >
          <Drawer
            id="command-dispatch-drawer"
            rootClassName={styles['terminal-command-drawer']}
            placement="bottom"
            size="var(--terminal-command-drawer-height)"
            open={commandDockOpen}
            getContainer={false}
            mask={false}
            closable={false}
            keyboard={false}
            autoFocus={false}
            focusable={{ trap: false, focusTriggerAfterClose: false }}
            push={false}
            destroyOnHidden
            aria-label={t('commandDispatch.title')}
            styles={{
              wrapper: {
                maxHeight: '100%',
                background: 'var(--terminal-frame)',
                boxShadow: 'none',
                opacity: 1,
                transitionDuration: '180ms',
                transitionProperty: 'transform',
              },
              section: {
                borderRadius: 0,
                background: 'var(--terminal-frame)',
                boxShadow: 'none',
              },
              body: {
                overflow: 'hidden',
                background: 'var(--terminal-frame)',
                padding: 0,
              },
            }}
          >
            {commandDock}
          </Drawer>
        </div>
        <div className={styles['terminal-statusbar']}>
          <StatusItem className={styles['is-session-position']} label={t('workbench.sessionCount')} value={sessionPositionLabel} />
          <StatusItem label={t('workbench.target')} value={targetLabel} />
          <StatusItem label={t('workbench.sessionState')} value={sessionStateLabel} />
          <StatusItem label={t('workbench.startedAt')} value={startedAt} />
          <StatusItem className={styles['is-responsive-secondary']} label={t('workbench.duration')} value={sessionDuration} />
          <StatusItem className={styles['is-responsive-secondary']} label={t('workbench.terminalSize')} value={`${terminalSize.cols} x ${terminalSize.rows}`} />
          <button
            type="button"
            className={[
              styles['terminal-command-toggle'],
              commandDockOpen ? styles['is-open'] : '',
              commandTaskActive ? styles['is-active'] : '',
            ].filter(Boolean).join(' ')}
            aria-expanded={commandDockOpen}
            aria-controls="command-dispatch-drawer"
            aria-label={t('commandDispatch.title')}
            data-command-dispatch-toggle=""
            onClick={onToggleCommandDock}
          >
            <SquareTerminal size={13} aria-hidden="true" />
            <span>{t('commandDispatch.title')}</span>
            {commandTargetCount > 0 ? <strong>{commandTargetCount}</strong> : null}
            {commandDockOpen
              ? <ChevronDown size={13} aria-hidden="true" />
              : <ChevronUp size={13} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  )
}

function StatusItem({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <span className={[styles['terminal-status-item'], className].filter(Boolean).join(' ')}>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  )
}
