import { Button, Modal, Tag, Tooltip } from 'antd'
import { AlertTriangle, Expand, Image as ImageIcon, Maximize2, RefreshCw, RotateCcw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { TermousApiError } from '#shared/api'
import type { RemoteImageFile } from '#entities/file'
import type { ThemeMode } from '#shared/theme'
import { FileOperationProgress, type FileOperationProgressState } from './FileOperationProgress'
import styles from './RemoteImageViewerModal.module.scss'
import sharedStyles from './RemoteFileModalShared.module.scss'
import type { FileOperationGateway } from '../model/fileOperationGateway'
import { formatBytes } from '#shared/format'
import { useFileOperationWatcher } from '../model/useFileOperationWatcher'

interface RemoteImageViewerModalProps {
  api: FileOperationGateway
  open: boolean
  fileSessionId: string
  path: string
  theme: ThemeMode
  onClose: () => void
}

interface ImageOffset {
  x: number
  y: number
}

interface DragState {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
}

export function RemoteImageViewerModal({ api, open, fileSessionId, path, theme, onClose }: RemoteImageViewerModalProps) {
  const { t } = useTranslation()
  const viewerRef = useRef<HTMLDivElement>(null)
  const blobUrlRef = useRef<string | null>(null)
  const loadSeqRef = useRef(0)
  const activeLoadKeyRef = useRef<string | null>(null)
  const completedLoadKeyRef = useRef<string | null>(null)
  const dragStateRef = useRef<DragState | null>(null)
  const [file, setFile] = useState<RemoteImageFile | null>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fitMode, setFitMode] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [offset, setOffset] = useState<ImageOffset>({ x: 0, y: 0 })
  const [operationProgress, setOperationProgress] = useState<FileOperationProgressState | null>(null)
  const {
    cancelActiveOperation,
    clearOperationTimers,
    finishOperationProgress,
    watchFileOperation,
  } = useFileOperationWatcher({ api, setOperationProgress })

  const revokeBlobUrl = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }
    setBlobUrl(null)
  }, [])

  const resetView = useCallback(() => {
    setFitMode(true)
    setZoom(1)
    setRotation(0)
    setOffset({ x: 0, y: 0 })
  }, [])

  const title = useMemo(() => file?.name || path, [file, path])
  const imageMeta = useMemo(() => {
    if (!file) {
      return []
    }
    const type = file.content_type.split('/').pop()?.toUpperCase() || t('files.imageViewerImage')
    return [
      type,
      naturalSize ? `${naturalSize.width} x ${naturalSize.height}` : '',
      formatBytes(file.size),
    ].filter(Boolean)
  }, [file, naturalSize, t])

  const loadImage = useCallback(async (force = false) => {
    if (!open || !fileSessionId || !path) {
      return
    }
    const loadKey = `${fileSessionId}\u0000${path}`
    if (!force && (activeLoadKeyRef.current === loadKey || completedLoadKeyRef.current === loadKey)) {
      return
    }
    const requestSeq = loadSeqRef.current + 1
    loadSeqRef.current = requestSeq
    activeLoadKeyRef.current = loadKey
    if (force) {
      completedLoadKeyRef.current = null
    }
    cancelActiveOperation()
    clearOperationTimers()
    setLoading(true)
    setError(null)
    setNaturalSize(null)
    resetView()
    revokeBlobUrl()
    setOperationProgress({
      title: t('files.fileOperationImageReadTitle'),
      description: t('files.fileOperationImageReadPrepare'),
      progress: 0,
      status: 'running',
      indeterminate: true,
    })
    try {
      const operation = await api.createFileSessionImageReadOperation(fileSessionId, path)
      await watchFileOperation(
        operation,
        t('files.fileOperationImageReadTitle'),
        t('files.fileOperationImageReadReady'),
        t('files.fileOperationImageReadFailed'),
      )
      const metadata = await api.fileOperationResult<RemoteImageFile>(operation.id)
      const blob = await api.fileOperationBlobResult(operation.id)
      if (loadSeqRef.current !== requestSeq) {
        return
      }
      const nextUrl = URL.createObjectURL(blob)
      blobUrlRef.current = nextUrl
      setFile(metadata)
      setBlobUrl(nextUrl)
      clearOperationTimers()
      setOperationProgress(null)
      completedLoadKeyRef.current = loadKey
    } catch (loadError) {
      if (loadSeqRef.current !== requestSeq) {
        return
      }
      const errorMessage = remoteImageErrorMessage(loadError, t)
      setFile(null)
      setError(errorMessage)
      finishOperationProgress({
        title: t('files.fileOperationImageReadTitle'),
        description: errorMessage || t('files.fileOperationImageReadFailed'),
        progress: 100,
        status: 'error',
      }, 2600)
    } finally {
      if (loadSeqRef.current === requestSeq) {
        setLoading(false)
      }
      if (activeLoadKeyRef.current === loadKey) {
        activeLoadKeyRef.current = null
      }
    }
  }, [
    api,
    cancelActiveOperation,
    clearOperationTimers,
    fileSessionId,
    finishOperationProgress,
    open,
    path,
    resetView,
    revokeBlobUrl,
    t,
    watchFileOperation,
  ])

  const changeZoom = useCallback((delta: number) => {
    setFitMode(false)
    setZoom((current) => Math.max(0.1, Math.min(6, Number((current + delta).toFixed(2)))))
  }, [])

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!blobUrl) {
      return
    }
    event.preventDefault()
    changeZoom(event.deltaY > 0 ? -0.12 : 0.12)
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!blobUrl || event.button !== 0) {
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }
    setOffset({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    })
  }

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null
    }
  }

  useEffect(() => {
    if (!open) {
      return undefined
    }
    const loadTimer = window.setTimeout(() => {
      void loadImage()
    }, 0)
    return () => window.clearTimeout(loadTimer)
  }, [loadImage, open])

  useEffect(() => {
    if (open) {
      return
    }
    loadSeqRef.current++
    cancelActiveOperation()
    clearOperationTimers()
    setOperationProgress(null)
    setError(null)
    setFile(null)
    activeLoadKeyRef.current = null
    completedLoadKeyRef.current = null
    revokeBlobUrl()
    resetView()
  }, [cancelActiveOperation, clearOperationTimers, open, resetView, revokeBlobUrl])

  useEffect(
    () => () => {
      loadSeqRef.current++
      activeLoadKeyRef.current = null
      completedLoadKeyRef.current = null
      cancelActiveOperation()
      clearOperationTimers()
      revokeBlobUrl()
    },
    [cancelActiveOperation, clearOperationTimers, revokeBlobUrl],
  )

  return (
    <Modal
      open={open}
      width="min(1120px, calc(100vw - 64px))"
      title={null}
      footer={null}
      centered
      destroyOnHidden
      className="termous-modal remote-image-viewer-modal"
      rootClassName={`termous-modal-root remote-image-viewer-root ${styles.root} ${theme === 'light' ? styles.light : ''} ${sharedStyles.root}`}
      onCancel={onClose}
    >
      <section className={`remote-image-viewer is-viewer-${theme}`}>
        <header className="remote-image-viewer-header">
          <div className="remote-text-editor-title">
            <span className="remote-text-editor-icon">
              <ImageIcon size={18} aria-hidden="true" />
            </span>
            <div>
              <strong>{title}</strong>
              <span>{file?.path ?? path}</span>
            </div>
          </div>
          <div className="remote-text-editor-meta">
            {imageMeta.map((item) => <Tag key={item}>{item}</Tag>)}
          </div>
        </header>
        <div className="remote-image-viewer-body">
          {operationProgress ? (
            <div className="remote-text-editor-operation-toast">
              <FileOperationProgress
                title={operationProgress.title}
                description={operationProgress.description}
                progress={operationProgress.progress}
                status={operationProgress.status}
                indeterminate={operationProgress.indeterminate}
                compact
              />
            </div>
          ) : null}
          {error && !blobUrl ? (
            <div className="remote-image-viewer-state is-error">
              <AlertTriangle size={24} aria-hidden="true" />
              <strong>{error}</strong>
              <Button className="secondary-button" icon={<RefreshCw size={14} />} onClick={() => void loadImage(true)}>
                {t('files.imageViewerReload')}
              </Button>
            </div>
          ) : (
            <div
              ref={viewerRef}
              className={`remote-image-viewer-stage ${blobUrl ? '' : 'is-empty'}`}
              onWheel={onWheel}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
            >
              {blobUrl ? (
                <img
                  className={fitMode ? 'is-fit' : 'is-actual'}
                  src={blobUrl}
                  alt={file?.name ?? path}
                  draggable={false}
                  style={{ transform: `translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg) scale(${zoom})` }}
                  onLoad={(event) => {
                    setNaturalSize({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    })
                  }}
                />
              ) : (
                <div className="remote-image-viewer-loading" aria-hidden="true">
                  <ImageIcon size={30} />
                </div>
              )}
            </div>
          )}
        </div>
        <footer className="remote-image-viewer-footer">
          <div className="remote-text-editor-hint">
            <ImageIcon size={14} aria-hidden="true" />
            <span>{t('files.imageViewerHint')}</span>
          </div>
          <div className="remote-image-viewer-actions">
            <Tooltip title={t('files.imageViewerFit')}>
              <Button className="secondary-button" icon={<Expand size={14} />} disabled={!blobUrl} onClick={() => {
                setFitMode(true)
                setZoom(1)
                setOffset({ x: 0, y: 0 })
              }} />
            </Tooltip>
            <Tooltip title={t('files.imageViewerActualSize')}>
              <Button className="secondary-button" icon={<Maximize2 size={14} />} disabled={!blobUrl} onClick={() => {
                setFitMode(false)
                setZoom(1)
                setOffset({ x: 0, y: 0 })
              }} />
            </Tooltip>
            <Tooltip title={t('files.imageViewerZoomOut')}>
              <Button className="secondary-button" icon={<ZoomOut size={14} />} disabled={!blobUrl} onClick={() => changeZoom(-0.2)} />
            </Tooltip>
            <Tooltip title={t('files.imageViewerZoomIn')}>
              <Button className="secondary-button" icon={<ZoomIn size={14} />} disabled={!blobUrl} onClick={() => changeZoom(0.2)} />
            </Tooltip>
            <Tooltip title={t('files.imageViewerRotateLeft')}>
              <Button className="secondary-button" icon={<RotateCcw size={14} />} disabled={!blobUrl} onClick={() => setRotation((value) => value - 90)} />
            </Tooltip>
            <Tooltip title={t('files.imageViewerRotateRight')}>
              <Button className="secondary-button" icon={<RotateCw size={14} />} disabled={!blobUrl} onClick={() => setRotation((value) => value + 90)} />
            </Tooltip>
            <Button className="secondary-button" disabled={loading} icon={<RefreshCw size={14} />} onClick={() => void loadImage(true)}>
              {t('files.imageViewerReload')}
            </Button>
            <Button className="secondary-button" onClick={onClose}>
              {t('app.close')}
            </Button>
          </div>
        </footer>
      </section>
    </Modal>
  )
}

function remoteImageErrorMessage(error: unknown, t: (key: string) => string) {
  if (error instanceof TermousApiError) {
    if (error.code === 'SFTP_IMAGE_TOO_LARGE') {
      return t('files.imageViewerTooLarge')
    }
    if (error.code === 'SFTP_IMAGE_NOT_PREVIEWABLE') {
      return t('files.imageViewerOnlyFiles')
    }
    if (error.code === 'SFTP_IMAGE_UNSUPPORTED') {
      return t('files.imageViewerUnsupported')
    }
    return error.message
  }
  return error instanceof Error ? error.message : t('app.error')
}
