import { Alert, Button, Input, Modal, Skeleton, Tooltip } from 'antd'
import {
  ArrowRightLeft,
  ArrowUp,
  Check,
  ChevronRight,
  CopyPlus,
  Folder,
  FolderOpen,
  FolderPlus,
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
  RemoteCopyModalProps,
  RemoteCopyTargetSession,
} from '../model/types.ts'
import { useRemoteCopyController } from '../controller/useRemoteCopyController.ts'
import chromeStyles from './RemoteCopyModalChrome.module.scss'
import styles from './RemoteCopyModal.module.scss'

const remoteCopyTooltipZIndex = 3500

export function RemoteCopyModal(props: RemoteCopyModalProps) {
  const { open, source, hosts, getHostIconUrl, onClose } = props
  const { t } = useTranslation()
  const controller = useRemoteCopyController(props)
  const sourceHost = hosts.find((host) => host.id === source.hostId)
  const breadcrumbs = useMemo(
    () => buildRemotePathBreadcrumbs(controller.currentPath || controller.pathInput),
    [controller.currentPath, controller.pathInput],
  )
  const busy = controller.submitting || controller.creatingDirectory

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
            <span>{t('files.remoteCopy.description', { count: source.entries.length })}</span>
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

        {!controller.sourceValidation.valid ? (
          <Alert
            type="warning"
            showIcon
            className={styles.alert}
            title={t('files.remoteCopy.unsupportedSelection')}
          />
        ) : null}

        <div className={styles.workspace}>
          <TargetSessionPane
            search={controller.search}
            targets={controller.visibleTargets}
            totalTargets={controller.allTargets.length}
            selectedSessionId={controller.selectedSessionId}
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
        </div>

        <ConflictPolicyPicker
          value={controller.conflictPolicy}
          disabled={busy}
          onChange={controller.setConflictPolicy}
        />

        {controller.submitError ? (
          <Alert
            type="error"
            showIcon
            className={styles.alert}
            title={t('files.remoteCopy.createFailed')}
            description={controller.submitError.startsWith('files.')
              ? t(controller.submitError)
              : controller.submitError}
          />
        ) : null}

        <footer className={chromeStyles.actions}>
          <Button disabled={busy} onClick={onClose}>{t('app.cancel')}</Button>
          <Button
            type="primary"
            danger={controller.conflictPolicy === 'overwrite'}
            icon={<Send size={14} aria-hidden="true" />}
            loading={busy}
            disabled={!controller.canSubmit || busy}
            onClick={() => void controller.submit()}
          >
            {t(busy ? 'files.remoteCopy.submitting' : 'files.remoteCopy.submit')}
          </Button>
        </footer>
      </section>
    </Modal>
  )
}

function TargetSessionPane({
  search,
  targets,
  totalTargets,
  selectedSessionId,
  getHostIconUrl,
  disabled,
  onSearch,
  onSelect,
}: {
  search: string
  targets: RemoteCopyTargetSession[]
  totalTargets: number
  selectedSessionId: string
  getHostIconUrl: (iconId: string) => string
  disabled: boolean
  onSearch: (value: string) => void
  onSelect: (sessionId: string) => void
}) {
  const { t } = useTranslation()
  return (
    <aside className={styles.targets} aria-label={t('files.remoteCopy.targetSession')}>
      <div className={styles['pane-heading']}>
        <span>
          <Server size={14} aria-hidden="true" />
          {t('files.remoteCopy.targetSession')}
        </span>
        <small>{totalTargets}</small>
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
        aria-label={t('files.remoteCopy.targetSession')}
      >
        {targets.length === 0 ? (
          <div className={styles['empty-targets']}>
            <Server size={22} aria-hidden="true" />
            <strong>{t('files.remoteCopy.noTargets')}</strong>
          </div>
        ) : targets.map((target) => {
          const selected = target.session.id === selectedSessionId
          return (
            <button
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              className={`${styles['target-row']} ${selected ? styles['is-selected'] : ''}`}
              key={target.session.id}
              onClick={() => onSelect(target.session.id)}
            >
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
              <span className={styles['target-check']} aria-hidden="true">
                {selected ? <Check size={12} strokeWidth={3} /> : null}
              </span>
            </button>
          )
        })}
      </div>
    </aside>
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
