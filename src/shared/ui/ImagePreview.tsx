import { Button, Modal, Spin, Tooltip } from 'antd'
import { ImageOff, Scan, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [trigger] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : undefined)
  const viewportRef = useRef<HTMLDivElement>(null)
  const ownershipRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()
    let objectURL: string | undefined
    setURL(undefined)
    setFailed(false)
    setSize(undefined)
    setZoom('fit')
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

  const ready = Boolean(size && !failed)
  const close = () => {
    onClose()
    // 对话框随资源卸载时，Ant Design 的关闭动画不会负责恢复触发按钮焦点。
    window.requestAnimationFrame(() => {
      if (document.activeElement === document.body && trigger?.isConnected && !trigger.closest('[inert]')) {
        trigger.focus({ preventScroll: true })
      }
    })
  }
  const adjustZoom = (direction: number) => {
    if (!size) return
    const viewport = viewportRef.current
    const current = zoom === 'fit' && viewport
      ? Math.min(1, viewport.clientWidth / size.width, viewport.clientHeight / size.height)
      : zoom === 'fit' ? 1 : zoom
    setZoom(Math.max(0.1, Math.min(4, Math.round((current + direction * 0.25) * 100) / 100)))
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
          <Tooltip title={t('imagePreview.zoomOut')}><Button type="text" disabled={!ready || zoom === 0.1} aria-label={t('imagePreview.zoomOut')} icon={<ZoomOut size={16} />} onClick={() => adjustZoom(-1)} /></Tooltip>
          <span className={styles.scale} aria-live="polite">{zoom === 'fit' ? t('imagePreview.fit') : `${Math.round(zoom * 100)}%`}</span>
          <Tooltip title={t('imagePreview.zoomIn')}><Button type="text" disabled={!ready || zoom === 4} aria-label={t('imagePreview.zoomIn')} icon={<ZoomIn size={16} />} onClick={() => adjustZoom(1)} /></Tooltip>
          <Button type="text" disabled={!ready} aria-pressed={zoom === 1} onClick={() => setZoom(1)}>{t('imagePreview.actualSize')}</Button>
          <Tooltip title={t('imagePreview.fit')}><Button type="text" disabled={!ready} aria-pressed={zoom === 'fit'} aria-label={t('imagePreview.fit')} icon={<Scan size={16} />} onClick={() => setZoom('fit')} /></Tooltip>
        </div>
      </div>
      <div ref={viewportRef} className={styles.viewport} aria-busy={!ready && !failed} tabIndex={0} aria-label={t('imagePreview.canvas')}>
        {failed ? <div className={styles.status} role="alert">
          <ImageOff size={26} aria-hidden="true" /><span>{t('imagePreview.failed')}</span>
          <Button onClick={() => setRevision((value) => value + 1)}>{t('imagePreview.retry')}</Button>
        </div> : <>
          {!size ? <div className={styles.status} role="status"><Spin size="small" /><span>{t('imagePreview.loading')}</span></div> : null}
          {url ? <div className={styles.canvas} data-fit={zoom === 'fit'}>
            <img key={url} src={url} alt={source.title} decoding="async" draggable={false}
              style={size && zoom !== 'fit' ? { width: size.width * zoom, height: size.height * zoom } : undefined}
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
      <div className={styles.hint}>{t('imagePreview.hint')}</div>
    </Modal>
  )
}
