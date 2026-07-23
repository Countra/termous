import { Alert, Breadcrumb, Button, Empty, Modal, Spin, Tooltip } from 'antd'
import { ArrowLeft, ChevronRight, Folder, FolderCheck, FolderDown, HardDrive, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TermousApi } from '../../api/client'
import type { LocalPathMapping, LocalTreeEntry } from '../../types/domain'
import '../../styles/local-download-destination.css'

export interface LocalDownloadDestinationModalProps {
  open: boolean
  api: TermousApi
  mappings: LocalPathMapping[]
  onConfirm: (path: string) => Promise<boolean>
  onCancel: () => void
  onManageMappings?: () => void
}

type DirectoryStatus = 'idle' | 'initial_loading' | 'ready' | 'navigating' | 'failed'

interface DestinationBreadcrumb {
  label: string
  path: string
}

interface PendingDestination {
  path: string
  breadcrumbs: DestinationBreadcrumb[]
}

interface RetryDestination extends PendingDestination {
  preserveListing: boolean
}

interface DestinationDirectoryState {
  mappingId: string
  path: string
  breadcrumbs: DestinationBreadcrumb[]
  entries: LocalTreeEntry[]
  status: DirectoryStatus
  hasLoaded: boolean
  error: string
  pending: PendingDestination | null
  retry: RetryDestination | null
}

const emptyDirectoryState: DestinationDirectoryState = {
  mappingId: '',
  path: '',
  breadcrumbs: [],
  entries: [],
  status: 'idle',
  hasLoaded: false,
  error: '',
  pending: null,
  retry: null,
}

export function LocalDownloadDestinationModal({
  open,
  api,
  mappings,
  onConfirm,
  onCancel,
  onManageMappings,
}: LocalDownloadDestinationModalProps) {
  const { t } = useTranslation()
  const [selectedMappingId, setSelectedMappingId] = useState('')
  const [directory, setDirectory] = useState<DestinationDirectoryState>(emptyDirectoryState)
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState('')
  const requestSequenceRef = useRef(0)
  const confirmSequenceRef = useRef(0)
  const requestAbortRef = useRef<AbortController | null>(null)
  const wasOpenRef = useRef(false)
  const mountedRef = useRef(true)
  const breadcrumbViewportRef = useRef<HTMLDivElement>(null)

  const selectedMapping = useMemo(
    () => mappings.find((mapping) => mapping.id === selectedMappingId) ?? null,
    [mappings, selectedMappingId],
  )
  const availableMappings = useMemo(
    () => mappings.filter((mapping) => mapping.available),
    [mappings],
  )
  const visibleBreadcrumbs = directory.pending?.breadcrumbs ?? directory.breadcrumbs
  const visibleDirectories = useMemo(
    () => directory.entries
      .filter((entry) => entry.kind === 'directory')
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })),
    [directory.entries],
  )
  const isInitialLoading = directory.status === 'initial_loading'
  const isNavigating = directory.status === 'navigating'
  const canConfirm = Boolean(
    selectedMapping?.available
    && directory.hasLoaded
    && directory.path
    && !isNavigating
    && !confirming,
  )

  useEffect(() => {
    if (!open || visibleBreadcrumbs.length === 0) {
      return
    }
    const frame = window.requestAnimationFrame(() => {
      const viewport = breadcrumbViewportRef.current
      if (viewport) {
        viewport.scrollLeft = viewport.scrollWidth
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open, visibleBreadcrumbs])

  const loadDirectory = useCallback(async (
    mapping: LocalPathMapping,
    path: string,
    breadcrumbs: DestinationBreadcrumb[],
    preserveListing: boolean,
  ) => {
    requestAbortRef.current?.abort()
    const controller = new AbortController()
    const requestSequence = requestSequenceRef.current + 1
    requestSequenceRef.current = requestSequence
    requestAbortRef.current = controller
    setConfirmError('')
    setDirectory((current) => {
      if (preserveListing && current.mappingId === mapping.id && current.hasLoaded) {
        return {
          ...current,
          status: 'navigating',
          error: '',
          pending: { path, breadcrumbs },
          retry: null,
        }
      }
      return {
        mappingId: mapping.id,
        path,
        breadcrumbs,
        entries: [],
        status: 'initial_loading',
        hasLoaded: false,
        error: '',
        pending: null,
        retry: null,
      }
    })

    try {
      const entries = await api.localPathMappingChildren(mapping.id, path, controller.signal)
      if (controller.signal.aborted || requestSequenceRef.current !== requestSequence) {
        return
      }
      setDirectory({
        mappingId: mapping.id,
        path,
        breadcrumbs,
        entries,
        status: 'ready',
        hasLoaded: true,
        error: '',
        pending: null,
        retry: null,
      })
    } catch (error) {
      if (controller.signal.aborted || requestSequenceRef.current !== requestSequence) {
        return
      }
      const message = error instanceof Error ? error.message : t('files.downloadDestinationLoadFailed')
      setDirectory((current) => {
        if (preserveListing && current.mappingId === mapping.id && current.hasLoaded) {
          return {
            ...current,
            status: 'failed',
            error: message,
            pending: null,
            retry: { path, breadcrumbs, preserveListing: true },
          }
        }
        return {
          mappingId: mapping.id,
          path,
          breadcrumbs,
          entries: [],
          status: 'failed',
          hasLoaded: false,
          error: message,
          pending: null,
          retry: { path, breadcrumbs, preserveListing: false },
        }
      })
    } finally {
      if (requestAbortRef.current === controller) {
        requestAbortRef.current = null
      }
    }
  }, [api, t])

  const selectMapping = useCallback((mapping: LocalPathMapping) => {
    if (!mapping.available) {
      return
    }
    const breadcrumbs = [{ label: mapping.name, path: mapping.path }]
    setSelectedMappingId(mapping.id)
    void loadDirectory(mapping, mapping.path, breadcrumbs, false)
  }, [loadDirectory])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!open) {
      if (wasOpenRef.current) {
        requestAbortRef.current?.abort()
        requestAbortRef.current = null
        requestSequenceRef.current += 1
        confirmSequenceRef.current += 1
        setConfirming(false)
        setConfirmError('')
      }
      wasOpenRef.current = false
      return
    }

    const currentMapping = mappings.find((mapping) => mapping.id === selectedMappingId && mapping.available)
    if (!wasOpenRef.current || !currentMapping) {
      wasOpenRef.current = true
      const firstMapping = availableMappings[0]
      if (firstMapping) {
        selectMapping(firstMapping)
      } else {
        setSelectedMappingId('')
        setDirectory(emptyDirectoryState)
      }
    }
  }, [availableMappings, mappings, open, selectMapping, selectedMappingId])

  const navigateToDirectory = useCallback((entry: LocalTreeEntry) => {
    if (!selectedMapping || !isAccessibleDirectory(entry) || confirming) {
      return
    }
    const breadcrumbs = [...directory.breadcrumbs, { label: entry.name, path: entry.path }]
    void loadDirectory(selectedMapping, entry.path, breadcrumbs, directory.hasLoaded)
  }, [confirming, directory.breadcrumbs, directory.hasLoaded, loadDirectory, selectedMapping])

  const navigateToBreadcrumb = useCallback((index: number) => {
    if (!selectedMapping || confirming) {
      return
    }
    const breadcrumbs = visibleBreadcrumbs.slice(0, index + 1)
    const target = breadcrumbs[index]
    if (!target) {
      return
    }
    void loadDirectory(selectedMapping, target.path, breadcrumbs, directory.hasLoaded)
  }, [confirming, directory.hasLoaded, loadDirectory, selectedMapping, visibleBreadcrumbs])

  const navigateBack = useCallback(() => {
    if (
      !selectedMapping
      || confirming
      || isInitialLoading
      || isNavigating
      || directory.breadcrumbs.length <= 1
    ) {
      return
    }
    const breadcrumbs = directory.breadcrumbs.slice(0, -1)
    const target = breadcrumbs[breadcrumbs.length - 1]
    if (target) {
      void loadDirectory(selectedMapping, target.path, breadcrumbs, directory.hasLoaded)
    }
  }, [
    confirming,
    directory.breadcrumbs,
    directory.hasLoaded,
    isInitialLoading,
    isNavigating,
    loadDirectory,
    selectedMapping,
  ])

  const refreshDirectory = useCallback(() => {
    if (!selectedMapping || !directory.path || confirming) {
      return
    }
    void loadDirectory(selectedMapping, directory.path, directory.breadcrumbs, directory.hasLoaded)
  }, [
    confirming,
    directory.breadcrumbs,
    directory.hasLoaded,
    directory.path,
    loadDirectory,
    selectedMapping,
  ])

  const retryDirectory = useCallback(() => {
    if (!selectedMapping || !directory.retry || confirming) {
      return
    }
    void loadDirectory(
      selectedMapping,
      directory.retry.path,
      directory.retry.breadcrumbs,
      directory.retry.preserveListing,
    )
  }, [confirming, directory.retry, loadDirectory, selectedMapping])

  const confirmDestination = useCallback(async () => {
    if (!canConfirm || !selectedMapping) {
      return
    }
    const confirmSequence = confirmSequenceRef.current + 1
    confirmSequenceRef.current = confirmSequence
    setConfirming(true)
    setConfirmError('')
    try {
      const stat = await api.localPathMappingStat(selectedMapping.id, directory.path)
      if (confirmSequenceRef.current !== confirmSequence) {
        return
      }
      if (!isAccessibleDirectory(stat)) {
        setConfirmError(t('files.downloadDestinationUnavailable'))
        return
      }
      const confirmed = await onConfirm(stat.path)
      if (confirmed && confirmSequenceRef.current === confirmSequence) {
        onCancel()
      }
    } catch (error) {
      if (confirmSequenceRef.current === confirmSequence) {
        setConfirmError(error instanceof Error ? error.message : t('files.downloadDestinationLoadFailed'))
      }
    } finally {
      if (mountedRef.current && confirmSequenceRef.current === confirmSequence) {
        setConfirming(false)
      }
    }
  }, [api, canConfirm, directory.path, onCancel, onConfirm, selectedMapping, t])

  const cancelModal = useCallback(() => {
    if (confirming) {
      return
    }
    requestAbortRef.current?.abort()
    requestSequenceRef.current += 1
    confirmSequenceRef.current += 1
    onCancel()
  }, [confirming, onCancel])

  const manageMappings = useCallback(() => {
    if (confirming || !onManageMappings) {
      return
    }
    onCancel()
    onManageMappings()
  }, [confirming, onCancel, onManageMappings])

  return (
    <Modal
      open={open}
      centered
      width={920}
      className="termous-modal local-download-destination-modal"
      rootClassName="termous-modal-root local-download-destination-modal-root"
      title={(
        <span className="local-download-destination-title">
          <FolderDown size={18} aria-hidden="true" />
          {t('files.downloadDestinationTitle')}
        </span>
      )}
      okText={t('files.downloadDestinationHere')}
      cancelText={t('app.cancel')}
      okButtonProps={{ disabled: !canConfirm }}
      cancelButtonProps={{ disabled: confirming }}
      confirmLoading={confirming}
      closable={!confirming}
      mask={{ closable: !confirming }}
      keyboard={!confirming}
      destroyOnHidden
      onOk={() => void confirmDestination()}
      onCancel={cancelModal}
    >
      <div className="local-download-destination-layout">
        <section className="local-download-destination-mappings" aria-label={t('files.downloadDestinationMappings')}>
          <header className="local-download-destination-pane-title">
            <HardDrive size={15} aria-hidden="true" />
            <span>{t('files.downloadDestinationMappings')}</span>
            <strong>{mappings.length}</strong>
          </header>
          <div className="local-download-destination-mapping-list">
            {mappings.length > 0 ? mappings.map((mapping) => (
              <Tooltip key={mapping.id} title={mapping.path} placement="right" mouseLeaveDelay={0}>
                <button
                  type="button"
                  className={`local-download-destination-mapping ${
                    selectedMappingId === mapping.id ? 'is-active' : ''
                  } ${mapping.available ? '' : 'is-unavailable'}`}
                  disabled={!mapping.available || confirming}
                  aria-pressed={selectedMappingId === mapping.id}
                  onClick={() => selectMapping(mapping)}
                >
                  <span className="local-download-destination-mapping-icon">
                    <HardDrive size={16} aria-hidden="true" />
                  </span>
                  <span className="local-download-destination-mapping-copy">
                    <strong>{mapping.name}</strong>
                    <small>{mapping.path}</small>
                  </span>
                  <span className={`local-download-destination-status ${mapping.available ? 'is-available' : ''}`}>
                    <i aria-hidden="true" />
                    {mapping.available ? t('status.available') : t('files.downloadDestinationUnavailable')}
                  </span>
                </button>
              </Tooltip>
            )) : (
              <div className="local-download-destination-no-mappings">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t('files.downloadDestinationNoMappings')}
                />
                <p>{t('files.downloadDestinationNoMappingsHint')}</p>
                {onManageMappings ? (
                  <Button onClick={manageMappings}>{t('files.downloadDestinationManage')}</Button>
                ) : null}
              </div>
            )}
          </div>
        </section>

        <section className="local-download-destination-browser" aria-label={t('files.downloadDestinationFolders')}>
          {selectedMapping ? (
            <>
              <header className="local-download-destination-browser-head">
                <div className="local-download-destination-browser-heading">
                  <Folder size={16} aria-hidden="true" />
                  <strong>{t('files.downloadDestinationFolders')}</strong>
                </div>
                <div className="local-download-destination-browser-actions">
                  {isNavigating ? (
                    <div className="local-download-destination-navigation-status" role="status">
                      <Spin size="small" />
                      <span>{t('files.localTreeLoading')}</span>
                    </div>
                  ) : null}
                  <Tooltip title={t('files.downloadDestinationRefresh')} mouseLeaveDelay={0}>
                    <Button
                      type="text"
                      className="local-download-destination-refresh"
                      aria-label={t('files.downloadDestinationRefresh')}
                      disabled={isInitialLoading || confirming}
                      icon={<RefreshCw size={15} className={isNavigating ? 'is-spinning' : ''} aria-hidden="true" />}
                      onClick={refreshDirectory}
                    />
                  </Tooltip>
                </div>
              </header>

              <div className="local-download-destination-pathbar">
                <Tooltip title={t('files.back')} mouseLeaveDelay={0}>
                  <Button
                    type="text"
                    className="local-download-destination-back"
                    aria-label={t('files.back')}
                    disabled={
                      confirming
                      || isInitialLoading
                      || isNavigating
                      || directory.breadcrumbs.length <= 1
                    }
                    icon={<ArrowLeft size={15} aria-hidden="true" />}
                    onClick={navigateBack}
                  />
                </Tooltip>
                <div
                  ref={breadcrumbViewportRef}
                  className="local-download-destination-breadcrumb-scroll"
                >
                  <Breadcrumb
                    separator={<ChevronRight size={13} aria-hidden="true" />}
                    items={visibleBreadcrumbs.map((breadcrumb, index) => ({
                      title: (
                        <button
                          type="button"
                          className="local-download-destination-breadcrumb"
                          disabled={confirming}
                          onClick={() => navigateToBreadcrumb(index)}
                        >
                          {index === 0 ? <HardDrive size={13} aria-hidden="true" /> : null}
                          <span>{breadcrumb.label}</span>
                        </button>
                      ),
                    }))}
                  />
                </div>
              </div>

              <div
                className={`local-download-destination-directory ${
                  isNavigating ? 'is-navigating' : ''
                }`}
                aria-busy={isInitialLoading || isNavigating}
              >
                {directory.status === 'failed' ? (
                  <Alert
                    className="local-download-destination-error"
                    type="error"
                    showIcon
                    message={t('files.downloadDestinationLoadFailed')}
                    description={directory.error}
                    action={(
                      <Button size="small" onClick={retryDirectory}>
                        {t('app.retry')}
                      </Button>
                    )}
                  />
                ) : null}

                {isInitialLoading ? (
                  <div className="local-download-destination-loading" role="status">
                    <Spin />
                    <span>{t('files.localTreeLoading')}</span>
                  </div>
                ) : directory.hasLoaded && visibleDirectories.length === 0 ? (
                  <Empty
                    className="local-download-destination-empty"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={(
                      <span>
                        <strong>{t('files.downloadDestinationEmpty')}</strong>
                        <small>{t('files.downloadDestinationEmptyHint')}</small>
                      </span>
                    )}
                  />
                ) : (
                  <div className="local-download-destination-directory-list">
                    {visibleDirectories.map((entry) => {
                      const accessible = isAccessibleDirectory(entry)
                      const selected = directory.pending?.path === entry.path
                      return (
                        <button
                          key={entry.path}
                          type="button"
                          className={`local-download-destination-directory-row ${
                            accessible ? '' : 'is-unavailable'
                          } ${selected ? 'is-selected' : ''}`}
                          disabled={!accessible || confirming}
                          aria-current={selected ? 'location' : undefined}
                          onClick={() => navigateToDirectory(entry)}
                        >
                          <span className="local-download-destination-directory-icon">
                            <Folder size={17} aria-hidden="true" />
                          </span>
                          <span className="local-download-destination-directory-copy">
                            <strong>{entry.name}</strong>
                            <small>{entry.path}</small>
                          </span>
                          {!accessible ? (
                            <span className="local-download-destination-directory-state">
                              {t('files.downloadDestinationUnavailable')}
                            </span>
                          ) : <ChevronRight size={15} aria-hidden="true" />}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              <footer className="local-download-destination-current">
                <span className="local-download-destination-current-icon">
                  <FolderCheck size={17} aria-hidden="true" />
                </span>
                <span className="local-download-destination-current-copy">
                  <strong>{t('files.downloadDestinationCurrent')}</strong>
                  <small>{directory.pending?.path ?? directory.path}</small>
                </span>
                <span className="local-download-destination-current-hint">
                  {t('files.downloadDestinationRenameHint')}
                </span>
              </footer>
              {confirmError ? (
                <Alert
                  className="local-download-destination-confirm-error"
                  type="error"
                  showIcon
                  message={confirmError}
                />
              ) : null}
            </>
          ) : (
            <div className="local-download-destination-unavailable">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={(
                  <span>
                    <strong>{t('files.downloadDestinationUnavailable')}</strong>
                    <small>{t('files.downloadDestinationNoMappingsHint')}</small>
                  </span>
                )}
              />
              {onManageMappings && mappings.length > 0 ? (
                <Button onClick={manageMappings}>{t('files.downloadDestinationManage')}</Button>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </Modal>
  )
}

function isAccessibleDirectory(entry: LocalTreeEntry) {
  return entry.kind === 'directory' && entry.is_accessible !== false
}
