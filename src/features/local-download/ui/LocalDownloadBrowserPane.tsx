import { Alert, Button, Skeleton, Tooltip } from 'antd'
import {
  ArrowUp,
  ChevronRight,
  Folder,
  FolderOpen,
  HardDrive,
  RefreshCw,
} from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { getTermousBridge } from '#shared/bridge'
import { uiStyles } from '#shared/ui'
import type { LocalPathMapping, LocalTreeEntry } from '#entities/file'
import {
  isLocalDirectoryBusy,
  localPathBreadcrumbs,
  localPathEquals,
  type LocalDirectoryViewState,
} from '../model/localDownloadWorkspaceState'
import type { useLocalDownloadDrop } from '../model/useLocalDownloadDrop'
import type { LocalDownloadTarget } from '../model/types'

type DropController = ReturnType<typeof useLocalDownloadDrop>

interface LocalDownloadBrowserPaneProps {
  mapping: LocalPathMapping | null
  state: LocalDirectoryViewState | null
  disabled?: boolean
  drop: DropController
  onNavigate: (path: string) => void
  onNavigateParent: () => void
  onRefresh: () => void
  onRetry: () => void
  onActionError: (message: string) => void
}

export function LocalDownloadBrowserPane({
  mapping,
  state,
  disabled = false,
  drop,
  onNavigate,
  onNavigateParent,
  onRefresh,
  onRetry,
  onActionError,
}: LocalDownloadBrowserPaneProps) {
  const { t } = useTranslation()
  const visiblePath = state?.pendingPath ?? state?.committedPath ?? ''
  const breadcrumbs = useMemo(
    () => mapping && visiblePath ? localPathBreadcrumbs(mapping, visiblePath) : [],
    [mapping, visiblePath],
  )
  const busy = state ? isLocalDirectoryBusy(state.status) : false
  const currentDirectoryTarget = useMemo<LocalDownloadTarget | null>(() => {
    if (!mapping?.available || !state?.hasLoaded || !state.committedPath || busy || disabled) {
      return null
    }
    return directoryTarget(mapping, state.committedPath)
  }, [busy, disabled, mapping, state?.committedPath, state?.hasLoaded])
  const currentDirectoryTargetKey = currentDirectoryTarget
    ? `current:${currentDirectoryTarget.mappingId}:${currentDirectoryTarget.path}`
    : ''
  const directoryEmpty = Boolean(state?.hasLoaded && state.entries.length === 0)
  const canNavigateParent = Boolean(
    mapping?.available
    && state?.hasLoaded
    && !localPathEquals(state.committedPath, mapping.path)
    && !disabled
    && !busy
  )

  const openLocalDirectory = async () => {
    const filesBridge = getTermousBridge()?.files
    if (
      disabled
      || !mapping?.available
      || !state?.committedPath
      || !filesBridge?.openDirectory
    ) {
      onActionError(t('files.openLocalDirectoryFailed'))
      return
    }
    try {
      const result = await filesBridge.openDirectory(state.committedPath)
      if (!result.ok) {
        onActionError(result.error || t('files.openLocalDirectoryFailed'))
      }
    } catch (error) {
      onActionError(
        error instanceof Error ? error.message : t('files.openLocalDirectoryFailed'),
      )
    }
  }

  return (
    <section
      className="local-download-console-browser"
      aria-label={t('files.downloadDestinationFolders')}
      aria-busy={busy}
    >
      <header className="local-download-console-pane-head">
        <span className="local-download-console-pane-title">
          <Folder size={15} aria-hidden="true" />
          {t('files.downloadDestinationFolders')}
        </span>
        <div className="local-download-console-pane-actions">
          <Tooltip title={t('files.back')} mouseLeaveDelay={0}>
            <Button
              type="text"
              size="small"
              aria-label={t('files.back')}
              disabled={!canNavigateParent}
              icon={<ArrowUp size={14} aria-hidden="true" />}
              onClick={onNavigateParent}
            />
          </Tooltip>
          <Tooltip title={t('files.downloadDestinationRefresh')} mouseLeaveDelay={0}>
            <Button
              type="text"
              size="small"
              aria-label={t('files.downloadDestinationRefresh')}
              disabled={disabled || !mapping?.available || !state?.hasLoaded || state.status === 'loading'}
              icon={(
                <RefreshCw
                  size={14}
                  aria-hidden="true"
                  className={state?.status === 'refreshing' ? `${uiStyles['is-spinning']} is-spinning` : ''}
                />
              )}
              onClick={onRefresh}
            />
          </Tooltip>
          <Tooltip title={t('files.openLocalDirectory')} mouseLeaveDelay={0}>
            <Button
              type="text"
              size="small"
              aria-label={t('files.openLocalDirectory')}
              disabled={disabled || !mapping?.available || !state?.hasLoaded}
              icon={<FolderOpen size={14} aria-hidden="true" />}
              onClick={() => void openLocalDirectory()}
            />
          </Tooltip>
        </div>
      </header>

      <nav
        className="local-download-console-breadcrumbs"
        aria-label={t('files.downloadDestinationCurrent')}
      >
        {breadcrumbs.map((breadcrumb, index) => (
          <span key={breadcrumb.path}>
            {index > 0 ? <ChevronRight size={12} aria-hidden="true" /> : null}
            <button
              type="button"
              disabled={disabled || busy || !mapping?.available}
              aria-current={index === breadcrumbs.length - 1 ? 'location' : undefined}
              onClick={() => onNavigate(breadcrumb.path)}
            >
              {index === 0 ? <HardDrive size={12} aria-hidden="true" /> : null}
              {breadcrumb.label}
            </button>
          </span>
        ))}
      </nav>

      <div
        className={[
          'local-download-console-directory-list',
          state?.status === 'navigating' ? 'is-navigating' : '',
          directoryEmpty ? 'is-empty' : '',
          drop.activeDropTarget === currentDirectoryTargetKey ? 'is-current-drop-target' : '',
          drop.busyDropTarget === currentDirectoryTargetKey ? 'is-drop-busy' : '',
        ].filter(Boolean).join(' ')}
        onDragOver={currentDirectoryTarget
          ? (event) => drop.onTargetDragOver(
              currentDirectoryTargetKey,
              currentDirectoryTarget,
              event,
            )
          : undefined}
        onDragLeave={currentDirectoryTarget
          ? (event) => drop.onTargetDragLeave(currentDirectoryTargetKey, event)
          : undefined}
        onDrop={currentDirectoryTarget
          ? (event) => void drop.onTargetDrop(
              currentDirectoryTargetKey,
              currentDirectoryTarget,
              event,
            )
          : undefined}
      >
        {!mapping ? (
          <div className="local-download-console-empty-copy">
            <HardDrive size={22} aria-hidden="true" />
            <strong>{t('files.downloadDestinationNoMappings')}</strong>
            <span>{t('files.downloadDestinationNoMappingsHint')}</span>
          </div>
        ) : !mapping.available ? (
          <div className="local-download-console-empty-copy">
            <HardDrive size={22} aria-hidden="true" />
            <strong>{mapping.name}</strong>
            <span>{t('files.downloadDestinationUnavailable')}</span>
          </div>
        ) : state?.status === 'loading' ? (
          <DirectorySkeleton />
        ) : (
          <>
            {state?.status === 'failed' ? (
              <Alert
                type="error"
                showIcon
                className="local-download-console-alert"
                title={t('files.downloadDestinationLoadFailed')}
                description={state.error}
                action={(
                  <Button type="text" size="small" disabled={disabled} onClick={onRetry}>
                    {t('app.retry')}
                  </Button>
                )}
              />
            ) : null}
            {state?.hasLoaded && state.entries.length === 0 ? (
              <div className="local-download-console-empty">
                <span className="local-download-console-empty-icon" aria-hidden="true">
                  <FolderOpen size={20} />
                </span>
                <strong>{t('files.downloadDestinationEmpty')}</strong>
                <small>{t('files.downloadDestinationEmptyHint')}</small>
              </div>
            ) : state?.entries.map((entry) => (
              <DirectoryRow
                key={entry.path}
                mapping={mapping}
                entry={entry}
                drop={drop}
                disabled={busy || disabled}
                onNavigate={onNavigate}
              />
            ))}
          </>
        )}
      </div>
    </section>
  )
}

function DirectoryRow({
  mapping,
  entry,
  drop,
  disabled,
  onNavigate,
}: {
  mapping: LocalPathMapping
  entry: LocalTreeEntry
  drop: DropController
  disabled: boolean
  onNavigate: (path: string) => void
}) {
  const target = directoryTarget(mapping, entry.path)
  const targetKey = `directory:${mapping.id}:${entry.path}`
  return (
    <Button
      type="text"
      htmlType="button"
      block
      className={[
        'local-download-console-directory-row',
        drop.activeDropTarget === targetKey ? 'is-drop-target' : '',
        drop.busyDropTarget === targetKey ? 'is-drop-busy' : '',
      ].filter(Boolean).join(' ')}
      disabled={disabled}
      onClick={() => onNavigate(entry.path)}
      onDragOver={(event) => drop.onTargetDragOver(targetKey, target, event)}
      onDragLeave={(event) => drop.onTargetDragLeave(targetKey, event)}
      onDrop={(event) => void drop.onTargetDrop(targetKey, target, event)}
    >
      <span className="local-download-console-row-icon" aria-hidden="true">
        <Folder size={16} />
      </span>
      <span className="local-download-console-row-copy">
        <strong>{entry.name}</strong>
        <small>{entry.path}</small>
      </span>
      <span className="local-download-console-row-affordance" aria-hidden="true">
        <ChevronRight size={14} />
      </span>
    </Button>
  )
}

function DirectorySkeleton() {
  return (
    <div className="local-download-console-skeleton" role="status">
      {[0, 1, 2].map((item) => (
        <div key={item}>
          <Skeleton.Avatar active size="small" shape="square" />
          <Skeleton.Input active size="small" />
        </div>
      ))}
    </div>
  )
}

function directoryTarget(mapping: LocalPathMapping, path: string): LocalDownloadTarget {
  return {
    mappingId: mapping.id,
    mappingName: mapping.name,
    mappingPath: mapping.path,
    path,
    available: mapping.available,
  }
}
