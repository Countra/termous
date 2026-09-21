import { Button, Modal, Tag, Tooltip } from 'antd'
import { AlertTriangle, Expand, Image as ImageIcon, Maximize2, RefreshCw, RotateCcw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { TermousApiError } from '#shared/api'
import { confirmDialogStyles, uiStyles } from '#shared/ui'
import type { RemoteImageFile } from '#entities/file'
import type { ThemeMode } from '#shared/theme'
import { FileOperationProgress, type FileOperationProgressState } from './FileOperationProgress'
import styles from './RemoteImageViewerModal.module.scss'
import sharedStyles from './RemoteFileModalShared.module.scss'
import type { FileOperationGateway } from '../model/fileOperationGateway'
import { formatBytes } from '#shared/format'
import { useFileOperationWatcher } from '../model/useFileOperationWatcher'
import { isFileOperationTerminal } from '../model/observeFileOperation'
import { fitImageScale, zoomImageView, MIN_IMAGE_SCALE, MAX_IMAGE_SCALE, type ImageOffset, type ImageView } from '../model/imageViewport'

interface RemoteImageViewerModalProps {
  api: FileOperationGateway
  open: boolean
  fileSessionId: string
  path: string
  theme: ThemeMode
  onClose: () => void
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
  const resultControllerRef = useRef<AbortController | null>(null)
  const activeLoadKeyRef = useRef<string | null>(null)
  const completedLoadKeyRef = useRef<string | null>(null)
  const dragStateRef = useRef<DragState | null>(null)
  const [file, setFile] = useState<RemoteImageFile | null>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ImageView>({ scale: null, rotation: 0, offset: { x: 0, y: 0 } })
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const fitScale = fitImageScale(naturalSize, viewport, view.rotation)
  const displayedScale = view.scale ?? fitScale
  const imageReady = Boolean(blobUrl && naturalSize && viewport.width && viewport.height)
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
    dragStateRef.current = null
    setView({ scale: null, rotation: 0, offset: { x: 0, y: 0 } })
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
    const resultController = new AbortController()
    resultControllerRef.current?.abort()
    resultControllerRef.current = resultController
    loadSeqRef.current = requestSeq
    activeLoadKeyRef.current = loadKey
    completedLoadKeyRef.current = null
    cancelActiveOperation()
    clearOperationTimers()
    setLoading(true)
    setError(null)
    setFile(null)
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
      // 创建请求可能晚于关闭或切图返回，不能再接管新图片的观察器。
      if (loadSeqRef.current !== requestSeq) {
        if (!isFileOperationTerminal(operation)) {
          void api.cancelFileOperation(operation.id).catch(() => {
            console.warn('[termous:files] 取消已过期的图片读取任务失败', operation.id)
          })
        }
        return
      }
      await watchFileOperation(
        operation,
        t('files.fileOperationImageReadTitle'),
        t('files.fileOperationImageReadReady'),
        t('files.fileOperationImageReadFailed'),
      )
      if (loadSeqRef.current !== requestSeq) return
      const metadata = await api.fileOperationResult<RemoteImageFile>(operation.id, resultController.signal)
      if (loadSeqRef.current !== requestSeq) return
      const blob = await api.fileOperationBlobResult(operation.id, resultController.signal)
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
      if (resultControllerRef.current === resultController) {
        resultControllerRef.current = null
      }
      if (loadSeqRef.current === requestSeq) {
        setLoading(false)
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

  const changeZoom = useCallback((factor: number, anchor: ImageOffset = { x: 0, y: 0 }) => {
    dragStateRef.current = null
    setView((current) => zoomImageView(current, fitImageScale(naturalSize, viewport, current.rotation), factor, anchor))
  }, [naturalSize, viewport])

  useEffect(() => {
    const stage = viewerRef.current
    if (!open || !stage) return
    const measure = () => setViewport({ width: stage.clientWidth, height: stage.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [open, blobUrl])

  useEffect(() => {
    const stage = viewerRef.current
    if (!stage || !imageReady) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      if (event.deltaY === 0) return
      const rect = stage.getBoundingClientRect()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1)
      changeZoom(Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.002), {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2,
      })
    }
    // React 的滚轮委托为被动监听，原生非被动监听才能阻止缩放时页面同时滚动。
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [imageReady, changeZoom])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!imageReady || event.button !== 0) {
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.offset.x,
      originY: view.offset.y,
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }
    const offset = {
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    }
    setView((current) => ({ ...current, offset }))
  }

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
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
    setLoading(false)
    setOperationProgress(null)
    setError(null)
    setFile(null)
    setNaturalSize(null)
    resetView()
    // 读取归属由窗口、会话和路径共同确定；依赖变化时立即使旧请求失效。
    return () => {
      loadSeqRef.current++
      resultControllerRef.current?.abort()
      resultControllerRef.current = null
      activeLoadKeyRef.current = null
      completedLoadKeyRef.current = null
      cancelActiveOperation()
      clearOperationTimers()
      revokeBlobUrl()
    }
  }, [cancelActiveOperation, clearOperationTimers, fileSessionId, open, path, resetView, revokeBlobUrl])

  return (
    <Modal
      open={open}
      width="min(1120px, calc(100vw - 64px))"
      title={null}
      footer={null}
      centered
      destroyOnHidden
      className="termous-modal remote-image-viewer-modal"
      rootClassName={`${confirmDialogStyles['modal-root']} termous-modal-root remote-image-viewer-root ${styles.root} ${theme === 'light' ? styles.light : ''} ${sharedStyles.root}`}
      onCancel={onClose}
    >
      <section className="remote-image-viewer">
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
              <Button className={`${uiStyles['secondary-button']} secondary-button`} icon={<RefreshCw size={14} />} onClick={() => void loadImage(true)}>
                {t('files.imageViewerReload')}
              </Button>
            </div>
          ) : (
            <div
              ref={viewerRef}
              className={`remote-image-viewer-stage ${blobUrl ? '' : 'is-empty'}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onLostPointerCapture={onPointerEnd}
            >
              {blobUrl ? (
                <img
                  src={blobUrl}
                  alt={file?.name ?? path}
                  draggable={false}
                  style={{
                    width: naturalSize?.width,
                    height: naturalSize?.height,
                    visibility: imageReady ? 'visible' : 'hidden',
                    transform: `translate(-50%, -50%) translate(${view.offset.x}px, ${view.offset.y}px) rotate(${view.rotation}deg) scale(${displayedScale})`,
                  }}
                  onLoad={(event) => {
                    setNaturalSize({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    })
                  }}
                  onError={() => {
                    setError(t('files.imageViewerUnsupported'))
                    setNaturalSize(null)
                    completedLoadKeyRef.current = null
                    revokeBlobUrl()
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
              <Button className={`${uiStyles['secondary-button']} secondary-button`} icon={<Expand size={14} />} aria-label={t('files.imageViewerFit')} aria-pressed={view.scale === null} disabled={!imageReady} onClick={() => {
                dragStateRef.current = null
                setView((current) => ({ ...current, scale: null, offset: { x: 0, y: 0 } }))
              }} />
            </Tooltip>
            <Tooltip title={t('files.imageViewerActualSize')}>
              <Button className={`${uiStyles['secondary-button']} secondary-button`} icon={<Maximize2 size={14} />} aria-label={t('files.imageViewerActualSize')} disabled={!imageReady} onClick={() => {
                dragStateRef.current = null
                setView((current) => ({ ...current, scale: 1, offset: { x: 0, y: 0 } }))
              }} />
            </Tooltip>
            <Tooltip title={t('files.imageViewerZoomOut')}>
              <Button className={`${uiStyles['secondary-button']} secondary-button`} icon={<ZoomOut size={14} />} aria-label={t('files.imageViewerZoomOut')} disabled={!imageReady || displayedScale <= MIN_IMAGE_SCALE} onClick={() => changeZoom(1 / 1.2)} />
            </Tooltip>
            <span className={styles['zoom-value']} aria-label={t('files.imageViewerZoom')}>{imageReady ? `${Number((displayedScale * 100).toFixed(1))}%` : '—'}</span>
            <Tooltip title={t('files.imageViewerZoomIn')}>
              <Button className={`${uiStyles['secondary-button']} secondary-button`} icon={<ZoomIn size={14} />} aria-label={t('files.imageViewerZoomIn')} disabled={!imageReady || displayedScale >= MAX_IMAGE_SCALE} onClick={() => changeZoom(1.2)} />
            </Tooltip>
            <Tooltip title={t('files.imageViewerRotateLeft')}>
              <Button className={`${uiStyles['secondary-button']} secondary-button`} icon={<RotateCcw size={14} />} aria-label={t('files.imageViewerRotateLeft')} disabled={!imageReady} onClick={() => {
                dragStateRef.current = null
                setView((current) => ({ ...current, rotation: (current.rotation - 90) % 360, offset: { x: 0, y: 0 } }))
              }} />
            </Tooltip>
            <Tooltip title={t('files.imageViewerRotateRight')}>
              <Button className={`${uiStyles['secondary-button']} secondary-button`} icon={<RotateCw size={14} />} aria-label={t('files.imageViewerRotateRight')} disabled={!imageReady} onClick={() => {
                dragStateRef.current = null
                setView((current) => ({ ...current, rotation: (current.rotation + 90) % 360, offset: { x: 0, y: 0 } }))
              }} />
            </Tooltip>
            <Button className={`${uiStyles['secondary-button']} secondary-button`} disabled={loading} icon={<RefreshCw size={14} />} onClick={() => void loadImage(true)}>
              {t('files.imageViewerReload')}
            </Button>
            <Button className={`${uiStyles['secondary-button']} secondary-button`} onClick={onClose}>
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
