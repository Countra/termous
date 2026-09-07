import { Alert, Button, Input, Modal, Segmented, Skeleton, Tooltip } from 'antd'
import {
  ArrowRightLeft,
  ArrowUp,
  Check,
  ChevronRight,
  CircleAlert,
  CopyPlus,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Network,
  Pencil,
  RefreshCw,
  Replace,
  Search,
  Send,
  Server,
  SkipForward,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HostAvatar } from '#entities/host'
import { buildRemotePathBreadcrumbs } from '../model/remoteCopyModel.ts'
import type {
  RemoteCopyConflictPolicy,
  RemoteCopyBatchFailure,
  RemoteCopyMode,
  RemoteCopyModalProps,
  RemoteCopyTargetSession,
} from '../model/types.ts'
import { useRemoteCopyController } from '../controller/useRemoteCopyController.ts'
import { useRemoteCopyBatchController } from '../controller/useRemoteCopyBatchController.ts'
import chromeStyles from './RemoteCopyModalChrome.module.scss'
import styles from './RemoteCopyModal.module.scss'

const remoteCopyTooltipZIndex = 3500

export function RemoteCopyModal(props: RemoteCopyModalProps) {
  const { open, source, hosts, getHostIconUrl, onClose } = props
  const { t } = useTranslation()
  const [mode, setMode] = useState<RemoteCopyMode>('single')
  const sourceIdentity = `${source.fileSessionId}:${source.connectionGeneration}:${source.entries.map((entry) => entry.path).join('\u0000')}`
  const controller = useRemoteCopyController({
    ...props,
    active: open && mode === 'single',
  })
  const batchController = useRemoteCopyBatchController({
    ...props,
    active: open && mode === 'batch',
  })
  const sourceHost = hosts.find((host) => host.id === source.hostId)
  const breadcrumbs = useMemo(
    () => buildRemotePathBreadcrumbs(controller.currentPath || controller.pathInput),
    [controller.currentPath, controller.pathInput],
  )
  const busy = mode === 'single'
    ? controller.submitting || controller.creatingDirectory
    : batchController.submitting
  const conflictPolicy = mode === 'single'
    ? controller.conflictPolicy
    : batchController.conflictPolicy
  const canSubmit = mode === 'single' ? controller.canSubmit : batchController.canSubmit
  const submitError = mode === 'single' ? controller.submitError : batchController.submitError

  useEffect(() => {
    if (open) {
      setMode('single')
    }
  }, [open, sourceIdentity])

  return (
    <Modal
      open={open}
      centered
      destroyOnHidden
      width={900}
      footer={null}
      title={t('files.remoteCopy.title')}
      closable={!busy}
      keyboard={!busy}
      mask={{ closable: !busy }}
      className={styles.modal}
      rootClassName={`${styles['modal-root']} termous-modal-root`}
      getContainer={() => document.body}
      onCancel={() => {
        if (!busy) {
          onClose()
        }
      }}
    >
      <section className={styles.dialog} aria-label={t('files.remoteCopy.title')}>
        <header className={chromeStyles.header}>
          <span className={chromeStyles['header-icon']} aria-hidden="true">
            <ArrowRightLeft size={20} />
          </span>
          <span className={chromeStyles['header-copy']}>
            <small>{t('files.remoteCopy.eyebrow')}</small>
            <strong>{t('files.remoteCopy.title')}</strong>
            <span>{t(
              mode === 'batch'
                ? 'files.remoteCopy.descriptionBatch'
                : 'files.remoteCopy.description',
              { count: source.entries.length },
            )}</span>
          </span>
          <span className={chromeStyles['source-summary']}>
            <small>{t('files.remoteCopy.source')}</small>
            <strong title={sourceHost?.name ?? source.hostId}>
              <Server size={13} aria-hidden="true" />
              {sourceHost?.name ?? source.hostId}
            </strong>
            <span>{t('files.remoteCopy.sourceItems', { count: source.entries.length })}</span>
          </span>
        </header>

        <div className={styles['mode-switch']}>
          <Segmented<RemoteCopyMode>
            block
            size="small"
            className={styles['mode-segmented']}
            value={mode}
            disabled={busy}
            aria-label={t('files.remoteCopy.modeLabel')}
            options={[
              {
                value: 'single',
                icon: <Server size={13} aria-hidden="true" />,
                label: t('files.remoteCopy.modeSingle'),
              },
              {
                value: 'batch',
                icon: <Network size={13} aria-hidden="true" />,
                label: t('files.remoteCopy.modeBatch'),
              },
            ]}
            onChange={setMode}
          />
        </div>

        {!(mode === 'single'
          ? controller.sourceValidation.valid
          : batchController.sourceValidation.valid) ? (
          <Alert
            type="warning"
            showIcon
            className={styles.alert}
            title={t('files.remoteCopy.unsupportedSelection')}
          />
        ) : null}

        <div className={`${styles.workspace} ${mode === 'batch' ? styles['is-batch'] : ''}`}>
          {mode === 'single' ? (
            <>
              <TargetSessionPane
                mode="single"
                search={controller.search}
                targets={controller.visibleTargets}
                totalTargets={controller.allTargets.length}
                selectedSessionIds={[controller.selectedSessionId]}
                completedSessionIds={new Set()}
                completedHostIds={new Set()}
                failures={[]}
                getHostIconUrl={getHostIconUrl}
                disabled={busy}
                onSearch={controller.setSearch}
                onSelect={controller.selectTarget}
              />
              <DirectoryPane
                target={controller.selectedTarget}
                pathInput={controller.pathInput}
                pathInputValid={controller.pathInputValid}
                currentPath={controller.currentPath}
                breadcrumbs={breadcrumbs}
                status={controller.directory.status}
                error={controller.directory.error}
                directories={controller.directory.listing?.entries ?? []}
                canCreateDirectory={controller.canCreateDirectory}
                creatingDirectory={controller.creatingDirectory}
                createDirectoryError={controller.createDirectoryError}
                disabled={busy}
                onPathInput={controller.setPathInput}
                onNavigate={controller.navigate}
                onParent={() => void controller.navigateParent()}
                onRefresh={() => void controller.refresh()}
                onClearCreateDirectoryError={controller.clearCreateDirectoryError}
                onCreateDirectory={controller.createTargetDirectory}
              />
            </>
          ) : (
            <>
              <TargetSessionPane
                mode="batch"
                search={batchController.search}
                targets={batchController.visibleTargets}
                totalTargets={batchController.allTargets.length}
                selectedSessionIds={batchController.selectedSessionIds}
                completedSessionIds={batchController.completedSessionIds}
                completedHostIds={batchController.completedHostIds}
                failures={batchController.failures}
                getHostIconUrl={getHostIconUrl}
                disabled={busy || batchController.parametersLocked}
                onSearch={batchController.setSearch}
                onSelect={batchController.toggleTarget}
              />
              <BatchDestinationPane
                pathInput={batchController.targetDirInput}
                pathInputValid={batchController.targetDirValid}
                selectedCount={batchController.selectedTargets.length}
                disabled={busy || batchController.parametersLocked}
                onPathInput={batchController.changeTargetDir}
              />
            </>
          )}
        </div>

        <ConflictPolicyPicker
          value={conflictPolicy}
          disabled={busy || (mode === 'batch' && batchController.parametersLocked)}
          onChange={mode === 'single'
            ? controller.setConflictPolicy
            : batchController.setConflictPolicy}
        />

        {mode === 'batch' && batchController.selectionError ? (
          <Alert
            type="warning"
            showIcon
            className={styles.alert}
            title={t(batchController.selectionError, { count: batchController.targetLimit })}
          />
        ) : null}

        {mode === 'batch' && batchController.outcome ? (
          <BatchOutcomeAlert
            createdCount={batchController.outcome.createdCount}
            failures={batchController.outcome.failures}
          />
        ) : null}

        {submitError ? (
          <Alert
            type="error"
            showIcon
            className={styles.alert}
            title={t('files.remoteCopy.createFailed')}
            description={submitError.startsWith('files.')
              ? t(submitError)
              : submitError}
          />
        ) : null}

        <footer className={chromeStyles.actions}>
          <Button disabled={busy} onClick={onClose}>{t('app.cancel')}</Button>
          <Button
            type="primary"
            danger={conflictPolicy === 'overwrite'}
            icon={<Send size={14} aria-hidden="true" />}
            loading={busy}
            disabled={!canSubmit || busy}
            onClick={() => void (mode === 'single'
              ? controller.submit()
              : batchController.submit())}
          >
            {t(
              busy
                ? 'files.remoteCopy.submitting'
                : mode === 'batch'
                  ? batchController.outcome
                    ? 'files.remoteCopy.batchRetry'
                    : 'files.remoteCopy.batchSubmit'
                  : 'files.remoteCopy.submit',
              { count: batchController.selectedTargets.length },
            )}
          </Button>
        </footer>
      </section>
    </Modal>
  )
}

function TargetSessionPane({
  mode,
  search,
  targets,
  totalTargets,
  selectedSessionIds,
  completedSessionIds,
  completedHostIds,
  failures,
  getHostIconUrl,
  disabled,
  onSearch,
  onSelect,
}: {
  mode: RemoteCopyMode
  search: string
  targets: RemoteCopyTargetSession[]
  totalTargets: number
  selectedSessionIds: readonly string[]
  completedSessionIds: ReadonlySet<string>
  completedHostIds: ReadonlySet<string>
  failures: readonly RemoteCopyBatchFailure[]
  getHostIconUrl: (iconId: string) => string
  disabled: boolean
  onSearch: (value: string) => void
  onSelect: (sessionId: string) => void
}) {
  const { t } = useTranslation()
  const selectedIdSet = new Set(selectedSessionIds)
  const failureBySessionId = new Map(failures.map((failure) => [failure.sessionId, failure]))
  return (
    <aside className={styles.targets} aria-label={t(
      mode === 'batch' ? 'files.remoteCopy.targetHosts' : 'files.remoteCopy.targetSession',
    )}>
      <div className={styles['pane-heading']}>
        <span>
          {mode === 'batch'
            ? <Network size={14} aria-hidden="true" />
            : <Server size={14} aria-hidden="true" />}
          {t(mode === 'batch' ? 'files.remoteCopy.targetHosts' : 'files.remoteCopy.targetSession')}
        </span>
        <small aria-label={t('files.remoteCopy.availableSessions', { count: totalTargets })}>
          {totalTargets}
        </small>
      </div>
      <Input
        allowClear
        value={search}
        disabled={disabled || totalTargets === 0}
        prefix={<Search size={13} aria-hidden="true" />}
        placeholder={t('files.remoteCopy.searchSessions')}
        aria-label={t('files.remoteCopy.searchSessions')}
        onChange={(event) => onSearch(event.target.value)}
      />
      <div
        className={styles['target-list']}
        role="group"
        aria-label={t(mode === 'batch'
          ? 'files.remoteCopy.targetHosts'
          : 'files.remoteCopy.targetSession')}
      >
        {targets.length === 0 ? (
          <div className={styles['empty-targets']}>
            <Server size={22} aria-hidden="true" />
            <strong>{t('files.remoteCopy.noTargets')}</strong>
          </div>
        ) : targets.map((target) => {
          const selected = selectedIdSet.has(target.session.id)
          const hostCompleted = completedHostIds.has(target.host.id)
          const completed = completedSessionIds.has(target.session.id)
            || (mode === 'batch' && hostCompleted)
          const failure = failureBySessionId.get(target.session.id)
          const targetDisabled = disabled || hostCompleted || failure?.retryable === false
          const content = (
            <>
              <HostAvatar
                host={target.host}
                getIconUrl={getHostIconUrl}
                className={styles['target-avatar']}
                size={30}
                iconSize={15}
              />
              <span className={styles['target-copy']}>
                <strong>{target.host.name}</strong>
                <small>{target.host.username}@{target.host.address}</small>
                {target.duplicateHostSession ? (
                  <small>{t('files.remoteCopy.sessionSuffix', { id: target.shortSessionId })}</small>
                ) : null}
              </span>
              <span
                className={`${styles['target-check']} ${mode === 'batch' ? styles['is-multiple'] : ''}`}
                aria-hidden="true"
                title={failure?.message}
              >
                {failure
                  ? <CircleAlert size={12} />
                  : selected || completed
                    ? <Check size={12} strokeWidth={3} />
                    : null}
              </span>
            </>
          )
          const rowClassName = [
            styles['target-row'],
            selected ? styles['is-selected'] : '',
            completed ? styles['is-completed'] : '',
            failure ? styles['has-failure'] : '',
            targetDisabled ? styles['is-disabled'] : '',
          ].filter(Boolean).join(' ')
          if (mode === 'batch') {
            return (
              <label
                className={rowClassName}
                key={target.session.id}
                aria-disabled={targetDisabled}
              >
                <input
                  type="checkbox"
                  className={styles['target-input']}
                  checked={selected || completed}
                  disabled={targetDisabled}
                  onChange={() => onSelect(target.session.id)}
                />
                {content}
              </label>
            )
          }
          return (
            <button
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              className={rowClassName}
              key={target.session.id}
              onClick={() => onSelect(target.session.id)}
            >
              {content}
            </button>
          )
        })}
      </div>
    </aside>
  )
}

function BatchDestinationPane({
  pathInput,
  pathInputValid,
  selectedCount,
  disabled,
  onPathInput,
}: {
  pathInput: string
  pathInputValid: boolean
  selectedCount: number
  disabled: boolean
  onPathInput: (path: string) => void
}) {
  const { t } = useTranslation()
  return (
    <section className={`${styles.browser} ${styles['batch-destination']}`}>
      <header className={styles['browser-heading']}>
        <span className={styles['browser-title']}>
          <FolderInput size={15} aria-hidden="true" />
          <span>
            <strong>{t('files.remoteCopy.batchDirectory')}</strong>
            <small>{t('files.remoteCopy.batchSelected', { count: selectedCount })}</small>
          </span>
        </span>
      </header>
      <div className={styles['batch-destination-content']}>
        <label className={styles['batch-path-field']}>
          <span>{t('files.remoteCopy.targetDirectory')}</span>
          <Input
            autoFocus
            value={pathInput}
            disabled={disabled}
            status={pathInput.length > 0 && !pathInputValid ? 'error' : undefined}
            prefix={<FolderOpen size={14} aria-hidden="true" />}
            placeholder={t('files.remoteCopy.batchPathPlaceholder')}
            aria-label={t('files.remoteCopy.targetDirectory')}
            spellCheck={false}
            onChange={(event) => onPathInput(event.target.value)}
          />
        </label>
        {pathInput.length > 0 && !pathInputValid ? (
          <small className={styles['batch-path-error']} role="alert">
            {t('files.remoteCopy.batchPathInvalid')}
          </small>
        ) : null}
        <div className={styles['batch-create-hint']}>
          <FolderPlus size={14} aria-hidden="true" />
          <span>{t('files.remoteCopy.batchCreateDirectoryHint')}</span>
        </div>
        <div className={styles['batch-target-summary']}>
          <Network size={21} aria-hidden="true" />
          <span>
            <strong>{t('files.remoteCopy.batchSelected', { count: selectedCount })}</strong>
            <small>{t(selectedCount > 0
              ? 'files.remoteCopy.batchReadyHint'
              : 'files.remoteCopy.batchSelectHint')}</small>
          </span>
        </div>
      </div>
    </section>
  )
}

function BatchOutcomeAlert({
  createdCount,
  failures,
}: {
  createdCount: number
  failures: readonly RemoteCopyBatchFailure[]
}) {
  const { t } = useTranslation()
  return (
    <Alert
      type={createdCount > 0 ? 'warning' : 'error'}
      showIcon
      className={styles.alert}
      title={t(
        createdCount > 0
          ? 'files.remoteCopy.batchPartialTitle'
          : 'files.remoteCopy.batchFailedTitle',
        { created: createdCount, failed: failures.length },
      )}
      description={(
        <ul className={styles['batch-failure-list']}>
          {failures.map((failure) => (
            <li key={failure.sessionId}>
              <strong>{failure.hostName}</strong>
              <span>{failure.message.startsWith('files.')
                ? t(failure.message)
                : failure.message}</span>
            </li>
          ))}
        </ul>
      )}
    />
  )
}

function DirectoryPane({
  target,
  pathInput,
  pathInputValid,
  currentPath,
  breadcrumbs,
  status,
  error,
  directories,
  canCreateDirectory,
  creatingDirectory,
  createDirectoryError,
  disabled,
  onPathInput,
  onNavigate,
  onParent,
  onRefresh,
  onClearCreateDirectoryError,
  onCreateDirectory,
}: {
  target: RemoteCopyTargetSession | null
  pathInput: string
  pathInputValid: boolean
  currentPath: string
  breadcrumbs: Array<{ label: string; path: string }>
  status: 'idle' | 'loading' | 'ready' | 'failed'
  error: string
  directories: Array<{ name: string; path: string }>
  canCreateDirectory: boolean
  creatingDirectory: boolean
  createDirectoryError: string
  disabled: boolean
  onPathInput: (path: string) => void
  onNavigate: (path: string) => Promise<boolean>
  onParent: () => void
  onRefresh: () => void
  onClearCreateDirectoryError: () => void
  onCreateDirectory: (name: string) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const loading = status === 'loading'
  const breadcrumbsRef = useRef<HTMLElement | null>(null)
  const [pathEditing, setPathEditing] = useState(false)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const targetIdentity = target
    ? `${target.session.id}:${target.session.connection_generation}:${currentPath}`
    : ''

  useEffect(() => {
    setPathEditing(false)
    setNewFolderOpen(false)
    setNewFolderName('')
    onClearCreateDirectoryError()
  }, [onClearCreateDirectoryError, targetIdentity])

  useEffect(() => {
    if (!pathEditing && breadcrumbsRef.current) {
      breadcrumbsRef.current.scrollLeft = breadcrumbsRef.current.scrollWidth
    }
  }, [breadcrumbs, pathEditing])

  const closeNewFolder = () => {
    if (creatingDirectory) {
      return
    }
    setNewFolderOpen(false)
    setNewFolderName('')
    onClearCreateDirectoryError()
  }

  const submitNewFolder = async () => {
    if (creatingDirectory) {
      return
    }
    if (await onCreateDirectory(newFolderName)) {
      setNewFolderOpen(false)
      setNewFolderName('')
    }
  }

  const startPathEdit = () => {
    onPathInput(currentPath || pathInput)
    setPathEditing(true)
  }

  const cancelPathEdit = () => {
    onPathInput(currentPath || pathInput)
    setPathEditing(false)
  }

  const submitPathEdit = async () => {
    if (!pathEditing || loading || !pathInputValid) {
      return
    }
    if (await onNavigate(pathInput)) {
      setPathEditing(false)
    }
  }

  return (
    <section className={styles.browser} aria-label={t('files.remoteCopy.targetDirectory')}>
      <header className={styles['browser-heading']}>
        <span className={styles['browser-title']}>
          <FolderOpen size={15} aria-hidden="true" />
          <span>
            <strong>{t('files.remoteCopy.targetDirectory')}</strong>
            {target ? <small title={target.host.name}>{target.host.name}</small> : null}
          </span>
        </span>
        <div className={styles['browser-actions']}>
          <Tooltip title={t('files.newFolder')} mouseLeaveDelay={0} zIndex={remoteCopyTooltipZIndex}>
            <Button
              type="text"
              size="small"
              className={styles['new-folder-trigger']}
              aria-label={t('files.newFolder')}
              disabled={disabled || !target || !canCreateDirectory || loading || newFolderOpen || pathEditing}
              icon={<FolderPlus size={14} aria-hidden="true" />}
              onClick={() => {
                setNewFolderName('')
                onClearCreateDirectoryError()
                setNewFolderOpen(true)
              }}
            />
          </Tooltip>
          <Tooltip title={t('files.remoteCopy.parent')} mouseLeaveDelay={0} zIndex={remoteCopyTooltipZIndex}>
            <Button
              type="text"
              size="small"
              aria-label={t('files.remoteCopy.parent')}
              disabled={disabled || newFolderOpen || pathEditing || !target || !currentPath || currentPath === '/' || loading}
              icon={<ArrowUp size={14} aria-hidden="true" />}
              onClick={onParent}
            />
          </Tooltip>
          <Tooltip title={t('files.remoteCopy.refresh')} mouseLeaveDelay={0} zIndex={remoteCopyTooltipZIndex}>
            <Button
              type="text"
              size="small"
              aria-label={t('files.remoteCopy.refresh')}
              disabled={disabled || newFolderOpen || pathEditing || !target || !currentPath || loading}
              icon={<RefreshCw size={14} aria-hidden="true" className={loading ? styles.spinning : ''} />}
              onClick={onRefresh}
            />
          </Tooltip>
        </div>
      </header>
      <div className={styles['browser-navigation']}>
        <div
          className={`${styles['path-bar']} ${pathEditing ? styles['is-editing'] : ''} ${pathEditing && !pathInputValid ? styles['has-error'] : ''}`}
        >
          <span className={styles['path-icon']} aria-hidden="true">
            <FolderOpen size={14} />
          </span>
          {pathEditing ? (
            <>
              <Input
                autoFocus
                className={styles['path-input']}
                variant="borderless"
                value={pathInput}
                disabled={disabled || newFolderOpen || !target || loading}
                status={pathInputValid ? undefined : 'error'}
                spellCheck={false}
                aria-invalid={!pathInputValid}
                aria-label={t('files.remoteCopy.targetDirectory')}
                placeholder={t('files.remoteCopy.pathPlaceholder')}
                onChange={(event) => onPathInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelPathEdit()
                  }
                }}
                onPressEnter={() => void submitPathEdit()}
              />
              <span className={styles['path-actions']}>
                <Tooltip
                  title={t('files.remoteCopy.cancelPathEdit')}
                  mouseLeaveDelay={0}
                  zIndex={remoteCopyTooltipZIndex}
                >
                  <Button
                    type="text"
                    aria-label={t('files.remoteCopy.cancelPathEdit')}
                    disabled={disabled || loading}
                    icon={<X size={14} aria-hidden="true" />}
                    onClick={cancelPathEdit}
                  />
                </Tooltip>
                <Tooltip title={t('files.remoteCopy.go')} mouseLeaveDelay={0} zIndex={remoteCopyTooltipZIndex}>
                  <Button
                    type="text"
                    aria-label={t('files.remoteCopy.go')}
                    disabled={disabled || !target || !pathInputValid || loading}
                    icon={<Check size={14} aria-hidden="true" />}
                    onClick={() => void submitPathEdit()}
                  />
                </Tooltip>
              </span>
            </>
          ) : (
            <>
              <nav
                ref={breadcrumbsRef}
                className={styles.breadcrumbs}
                aria-label={t('files.remoteCopy.targetDirectory')}
              >
                {breadcrumbs.map((item, index) => (
                  <span key={item.path}>
                    {index > 0 ? <ChevronRight size={11} aria-hidden="true" /> : null}
                    <button
                      type="button"
                      disabled={disabled || newFolderOpen || loading || !target}
                      aria-current={index === breadcrumbs.length - 1 ? 'location' : undefined}
                      onClick={() => void onNavigate(item.path)}
                    >
                      {item.label}
                    </button>
                  </span>
                ))}
              </nav>
              <Tooltip title={t('files.remoteCopy.editPath')} mouseLeaveDelay={0} zIndex={remoteCopyTooltipZIndex}>
                <Button
                  type="text"
                  className={styles['path-edit-trigger']}
                  aria-label={t('files.remoteCopy.editPath')}
                  disabled={disabled || newFolderOpen || !target || loading}
                  icon={<Pencil size={13} aria-hidden="true" />}
                  onClick={startPathEdit}
                />
              </Tooltip>
            </>
          )}
        </div>
      </div>
      <div
        className={styles['directory-list']}
        aria-busy={loading}
        aria-label={t('files.remoteCopy.targetDirectory')}
      >
        {newFolderOpen ? (
          <form
            className={styles['new-folder-editor']}
            aria-label={t('files.newFolder')}
            onSubmit={(event) => {
              event.preventDefault()
              void submitNewFolder()
            }}
          >
            <span className={styles['new-folder-icon']} aria-hidden="true">
              <FolderPlus size={16} />
            </span>
            <Input
              autoFocus
              value={newFolderName}
              disabled={creatingDirectory}
              status={createDirectoryError ? 'error' : undefined}
              placeholder={t('files.folderName')}
              aria-label={t('files.folderName')}
              onChange={(event) => {
                setNewFolderName(event.target.value)
                onClearCreateDirectoryError()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  closeNewFolder()
                }
              }}
            />
            <Tooltip title={t('app.cancel')} mouseLeaveDelay={0} zIndex={remoteCopyTooltipZIndex}>
              <Button
                type="text"
                size="small"
                aria-label={t('app.cancel')}
                disabled={creatingDirectory}
                icon={<X size={14} aria-hidden="true" />}
                onClick={closeNewFolder}
              />
            </Tooltip>
            <Tooltip title={t('app.create')} mouseLeaveDelay={0} zIndex={remoteCopyTooltipZIndex}>
              <Button
                type="primary"
                size="small"
                htmlType="submit"
                aria-label={t('app.create')}
                loading={creatingDirectory}
                disabled={creatingDirectory || newFolderName.trim().length === 0}
                icon={<Check size={14} aria-hidden="true" />}
              />
            </Tooltip>
            {createDirectoryError ? (
              <small className={styles['new-folder-error']} role="alert">
                {createDirectoryError.startsWith('files.')
                  ? t(createDirectoryError)
                  : createDirectoryError}
              </small>
            ) : null}
          </form>
        ) : null}
        {!target ? (
          <DirectoryEmpty label={t('files.remoteCopy.noTargets')} />
        ) : status === 'loading' && !currentPath ? (
          <DirectorySkeleton />
        ) : status === 'failed' ? (
          <Alert
            type="error"
            showIcon
            className={styles['directory-alert']}
            title={t('files.remoteCopy.directoryLoadFailed')}
            description={error}
            action={(
              <Button size="small" type="text" disabled={disabled} onClick={onRefresh}>
                {t('files.remoteCopy.directoryRetry')}
              </Button>
            )}
          />
        ) : status === 'ready' && directories.length === 0 ? (
          <DirectoryEmpty label={t('files.remoteCopy.directoryEmpty')} />
        ) : directories.map((directory) => (
          <button
            type="button"
            className={styles['directory-row']}
            disabled={disabled || loading || newFolderOpen || pathEditing}
            key={directory.path}
            onClick={() => onNavigate(directory.path)}
          >
            <span className={styles['folder-icon']} aria-hidden="true"><Folder size={17} /></span>
            <span className={styles['directory-name']} title={directory.name}>{directory.name}</span>
            <span className={styles['directory-affordance']} aria-hidden="true">
              <ChevronRight size={14} />
            </span>
          </button>
        ))}
        {loading && currentPath ? <div className={styles['loading-cover']}><RefreshCw size={16} /></div> : null}
      </div>
    </section>
  )
}

function ConflictPolicyPicker({
  value,
  disabled,
  onChange,
}: {
  value: RemoteCopyConflictPolicy
  disabled: boolean
  onChange: (policy: RemoteCopyConflictPolicy) => void
}) {
  const { t } = useTranslation()
  const policies: Array<{
    value: RemoteCopyConflictPolicy
    icon: typeof CopyPlus
    label: string
    hint: string
  }> = [
    {
      value: 'rename',
      icon: CopyPlus,
      label: t('files.remoteCopy.policyRename'),
      hint: t('files.remoteCopy.policyRenameHint'),
    },
    {
      value: 'skip',
      icon: SkipForward,
      label: t('files.remoteCopy.policySkip'),
      hint: t('files.remoteCopy.policySkipHint'),
    },
    {
      value: 'overwrite',
      icon: Replace,
      label: t('files.remoteCopy.policyOverwrite'),
      hint: t('files.remoteCopy.policyOverwriteHint'),
    },
  ]
  return (
    <fieldset className={chromeStyles.policies} disabled={disabled}>
      <legend>{t('files.remoteCopy.conflictPolicy')}</legend>
      <div className={chromeStyles['policy-grid']}>
        {policies.map((policy) => {
          const Icon = policy.icon
          const selected = value === policy.value
          return (
            <label
              className={`${chromeStyles.policy} ${selected ? chromeStyles['is-selected'] : ''} ${policy.value === 'overwrite' ? chromeStyles['is-overwrite'] : ''}`}
              key={policy.value}
            >
              <input
                type="radio"
                name="remote-copy-conflict-policy"
                value={policy.value}
                checked={selected}
                onChange={() => onChange(policy.value)}
              />
              <span className={chromeStyles['policy-icon']} aria-hidden="true"><Icon size={16} /></span>
              <span className={chromeStyles['policy-copy']}>
                <strong>{policy.label}</strong>
                <small>{policy.hint}</small>
              </span>
              <span className={chromeStyles['policy-check']} aria-hidden="true">
                {selected ? <Check size={11} strokeWidth={3} /> : null}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

function DirectorySkeleton() {
  return (
    <div className={styles.skeleton} role="status">
      {[0, 1, 2, 3].map((item) => (
        <span key={item}>
          <Skeleton.Avatar active shape="square" size="small" />
          <Skeleton.Input active size="small" />
        </span>
      ))}
    </div>
  )
}

function DirectoryEmpty({ label }: { label: string }) {
  return (
    <div className={styles['directory-empty']}>
      <FolderOpen size={23} aria-hidden="true" />
      <strong>{label}</strong>
    </div>
  )
}
