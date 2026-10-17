import { Button, Modal, Spin, Tooltip } from 'antd'
import { ImageOff, Scan, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useImageViewport } from './image-preview/useImageViewport'
import styles from './ImagePreview.module.scss'

export interface ImagePreviewSource {
  // 标识应包含资源版本；切换标识会取消旧读取并回收旧图片。
  id: string
  title: string
  load: (signal: AbortSignal) => Promise<Blob>
}

export function ImagePreview({ source, onClose }: { source?: ImagePreviewSource; onClose: () => void }) {
  return source ? <ImagePreviewDialog key={source.id} source={source} onClose={onClose} /> : null
}

function ImagePreviewDialog({ source, onClose }: { source: ImagePreviewSource; onClose: () => void }) {
  const { t } = useTranslation()
  const sourceRef = useRef(source)
  sourceRef.current = source
  const [url, setURL] = useState<string>()
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const [size, setSize] = useState<{ width: number; height: number }>()
  const [trigger] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : undefined)
  const ownershipRef = useRef<string | undefined>(undefined)
  const hintID = useId()
  const ready = Boolean(size && !failed)
  const view = useImageViewport(size, ready)

  useEffect(() => {
    const controller = new AbortController()
    let objectURL: string | undefined
    setURL(undefined)
    setFailed(false)
    setSize(undefined)
    void Promise.resolve().then(() => {
      controller.signal.throwIfAborted()
      return sourceRef.current.load(controller.signal)
    }).then((blob) => {
      if (controller.signal.aborted) return
      objectURL = URL.createObjectURL(blob)
      ownershipRef.current = objectURL
      setURL(objectURL)
    }).catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => {
      controller.abort()
      if (objectURL) URL.revokeObjectURL(objectURL)
      if (ownershipRef.current === objectURL) ownershipRef.current = undefined
    }
  }, [revision])

  const close = () => {
    onClose()
    // 对话框随资源卸载时，Ant Design 的关闭动画不会负责恢复触发按钮焦点。
    window.requestAnimationFrame(() => {
      if (document.activeElement === document.body && trigger?.isConnected && !trigger.closest('[inert]')) {
        trigger.focus({ preventScroll: true })
      }
    })
  }

  return (
    <Modal
      open centered width="min(1120px, calc(100vw - 32px))" title={source.title}
      footer={null} destroyOnHidden onCancel={close}
      className={`${styles.modal} termous-modal`} rootClassName="termous-modal-root"
    >
      <div className={styles.toolbar} role="toolbar" aria-label={t('imagePreview.controls')}>
        <span className={styles.dimensions}>{size ? `${size.width} × ${size.height}` : t('imagePreview.title')}</span>
        <div className={styles.actions}>
          <Tooltip title={t('imagePreview.zoomOut')}><Button type="text" disabled={!ready || !view.canZoomOut} aria-label={t('imagePreview.zoomOut')} icon={<ZoomOut size={16} />} onClick={() => view.adjustZoom(-1)} /></Tooltip>
          <span className={styles.scale} aria-live="polite">{view.zoom === 'fit' ? t('imagePreview.fit') : `${Math.round(view.scale * 100)}%`}</span>
          <Tooltip title={t('imagePreview.zoomIn')}><Button type="text" disabled={!ready || !view.canZoomIn} aria-label={t('imagePreview.zoomIn')} icon={<ZoomIn size={16} />} onClick={() => view.adjustZoom(1)} /></Tooltip>
          <Button type="text" disabled={!ready} aria-pressed={view.zoom === 1} onClick={() => view.changeZoom(1)}>{t('imagePreview.actualSize')}</Button>
          <Tooltip title={t('imagePreview.fit')}><Button type="text" disabled={!ready} aria-pressed={view.zoom === 'fit'} aria-label={t('imagePreview.fit')} icon={<Scan size={16} />} onClick={() => view.changeZoom('fit')} /></Tooltip>
        </div>
      </div>
      <div ref={view.viewport} className={styles.viewport} role="region" aria-busy={!ready && !failed} tabIndex={0}
        aria-label={t('imagePreview.canvas')} aria-describedby={hintID} data-pannable={view.canPan} data-dragging={view.dragging} data-ready={ready} {...view.handlers}>
        {failed ? <div className={styles.status} role="alert">
          <ImageOff size={26} aria-hidden="true" /><span>{t('imagePreview.failed')}</span>
          <Button onClick={() => setRevision((value) => value + 1)}>{t('imagePreview.retry')}</Button>
        </div> : <>
          {!size ? <div className={styles.status} role="status"><Spin size="small" /><span>{t('imagePreview.loading')}</span></div> : null}
          {url ? <div className={styles.canvas}>
            <img key={url} src={url} alt={source.title} decoding="async" draggable={false}
              style={{ visibility: ready ? 'visible' : 'hidden', width: size ? size.width * view.scale : undefined, height: size ? size.height * view.scale : undefined,
                transform: `translate(-50%, -50%) translate(${view.offset.x}px, ${view.offset.y}px)` }}
              onLoad={(event) => {
                if (ownershipRef.current !== url) return
                const { naturalWidth: width, naturalHeight: height } = event.currentTarget
                if (width > 0 && height > 0) setSize({ width, height })
                else setFailed(true)
              }}
              onError={() => { if (ownershipRef.current === url) setFailed(true) }}
            />
          </div> : null}
        </>}
      </div>
      <div id={hintID} className={styles.hint}>{t('imagePreview.hint')}</div>
    </Modal>
  )
}
