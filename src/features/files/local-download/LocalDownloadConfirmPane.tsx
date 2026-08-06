import { Alert, Button, Tooltip } from 'antd'
import {
  Download,
  FolderCheck,
  MousePointer2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { LocalPathMapping } from '#entities/file'
import type { LocalDirectoryViewState } from './localDownloadWorkspaceState'
import type { RemoteFileDragSelection } from './remoteFileDragRegistry'
import type { useLocalDownloadDrop } from './useLocalDownloadDrop'
import type { LocalDownloadTarget } from './types'

type DropController = ReturnType<typeof useLocalDownloadDrop>

interface LocalDownloadConfirmPaneProps {
  mapping: LocalPathMapping | null
  state: LocalDirectoryViewState | null
  selection: RemoteFileDragSelection | null
  confirming: boolean
  disabled?: boolean
  error: string
  drop: DropController
  onConfirm: () => void
}

export function LocalDownloadConfirmPane({
  mapping,
  state,
  selection,
  confirming,
  disabled = false,
  error,
  drop,
  onConfirm,
}: LocalDownloadConfirmPaneProps) {
  const { t } = useTranslation()
  const target = mapping && state?.hasLoaded
    ? currentTarget(mapping, state.committedPath)
    : null
  const targetKey = target ? `current:${target.mappingId}:${target.path}` : ''
  const selectionCount = selection?.paths.length ?? 0
  const canConfirm = Boolean(
    target
    && target.available
    && selectionCount > 0
    && !disabled
    && !confirming
    && !drop.busyDropTarget,
  )

  return (
    <section
      className={[
        'local-download-console-confirm',
        targetKey && drop.activeDropTarget === targetKey ? 'is-drop-target' : '',
        targetKey && drop.busyDropTarget === targetKey ? 'is-drop-busy' : '',
      ].filter(Boolean).join(' ')}
      aria-label={t('files.downloadDestinationCurrent')}
      onDragOver={(event) => target && drop.onTargetDragOver(targetKey, target, event)}
      onDragLeave={(event) => drop.onTargetDragLeave(targetKey, event)}
      onDrop={(event) => target && void drop.onTargetDrop(targetKey, target, event)}
    >
      <header className="local-download-console-confirm-title">
        <FolderCheck size={16} aria-hidden="true" />
        <span>{t('files.downloadDestinationCurrent')}</span>
      </header>
      <div className="local-download-console-target-copy">
        <strong>{mapping?.name ?? t('files.downloadDestinationUnavailable')}</strong>
        <Tooltip
          title={target?.path}
          placement="topLeft"
          mouseEnterDelay={0.35}
          classNames={{ root: 'file-name-tooltip' }}
        >
          <small>{target?.path ?? t('files.downloadDestinationNoMappingsHint')}</small>
        </Tooltip>
      </div>
      <div className="local-download-console-selection">
        <MousePointer2 size={14} aria-hidden="true" />
        <span>
          {selectionCount > 0
            ? t('files.selectedCount', { count: selectionCount })
            : t('files.localDownloadNoSelection')}
        </span>
      </div>
      <p>{t('files.downloadDestinationRenameHint')}</p>
      {drop.nativeFilesRejected ? (
        <Alert
          type="warning"
          showIcon
          className="local-download-console-inline-alert"
          title={t('files.localDownloadNativeFilesRejected')}
        />
      ) : null}
      {error ? (
        <Alert
          type="error"
          showIcon
          className="local-download-console-inline-alert"
          title={error}
        />
      ) : null}
      <Button
        type="primary"
        className="local-download-console-confirm-button"
        disabled={!canConfirm}
        loading={confirming || Boolean(drop.busyDropTarget)}
        icon={<Download size={15} aria-hidden="true" />}
        onClick={onConfirm}
      >
        {t('files.downloadDestinationHere')}
      </Button>
    </section>
  )
}

function currentTarget(mapping: LocalPathMapping, path: string): LocalDownloadTarget {
  return {
    mappingId: mapping.id,
    mappingName: mapping.name,
    mappingPath: mapping.path,
    path,
    available: mapping.available,
  }
}
