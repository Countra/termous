import { Image as ImageIcon, ImageOff, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AgentAttachment } from '#entities/agent'
import styles from './AgentAttachmentThumbnail.module.scss'

export type AgentAttachmentThumbnailSource =
  | {
      kind: 'local'
      blob: Blob
    }
  | {
      kind: 'remote'
      attachment: AgentAttachment
      load: (attachment: AgentAttachment, signal?: AbortSignal) => Promise<Blob>
    }

export function AgentAttachmentThumbnail({
  source,
  alt,
  className,
}: {
  source: AgentAttachmentThumbnailSource
  alt: string
  className?: string
}) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const releaseRef = useRef<{ objectURL: string; release: () => void } | undefined>(undefined)
  const sourceKind = source.kind
  const localBlob = source.kind === 'local' ? source.blob : undefined
  const remoteAttachment = source.kind === 'remote' ? source.attachment : undefined
  const remoteLoad = source.kind === 'remote' ? source.load : undefined
  const remoteAttachmentRef = useRef(remoteAttachment)
  remoteAttachmentRef.current = remoteAttachment
  const remoteIdentity = remoteAttachment
    ? `${remoteAttachment.id}:${remoteAttachment.revision}`
    : ''
  const identity: Blob | string = source.kind === 'local' ? source.blob : remoteIdentity
  const [observation, setObservation] = useState({ identity: remoteIdentity, nearby: false })
  const [view, setView] = useState<ThumbnailView>({ identity, phase: 'idle' })
  const nearby = source.kind === 'local'
    || (observation.identity === remoteIdentity && observation.nearby)

  useEffect(() => {
    if (sourceKind === 'local') return undefined
    const target = rootRef.current
    if (!target) return undefined
    setObservation({ identity: remoteIdentity, nearby: false })
    if (typeof IntersectionObserver === 'undefined') {
      setObservation({ identity: remoteIdentity, nearby: true })
      return undefined
    }
    const observer = new IntersectionObserver((entries) => {
      const entry = entries.find((candidate) => candidate.target === target)
      if (!entry) return
      setObservation({
        identity: remoteIdentity,
        nearby: entry.isIntersecting || entry.intersectionRatio > 0,
      })
    }, {
      rootMargin: '160px',
      threshold: 0.01,
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [remoteIdentity, sourceKind])

  useEffect(() => {
    let objectURL: string | undefined
    let released = false
    const controller = sourceKind === 'remote' ? new AbortController() : undefined
    const release = () => {
      if (!objectURL || released) return
      released = true
      URL.revokeObjectURL(objectURL)
    }
    const publish = (blob: Blob) => {
      try {
        const nextURL = URL.createObjectURL(blob)
        if (controller?.signal.aborted) {
          URL.revokeObjectURL(nextURL)
          return
        }
        objectURL = nextURL
        releaseRef.current = { objectURL: nextURL, release }
        setView({ identity, phase: 'ready', objectURL: nextURL })
      } catch {
        if (!controller?.signal.aborted) setView({ identity, phase: 'failed' })
      }
    }

    if (sourceKind === 'local' && localBlob) {
      setView({ identity, phase: 'loading' })
      publish(localBlob)
    } else if (!nearby) {
      setView({ identity, phase: 'idle' })
    } else {
      setView({ identity, phase: 'loading' })
      const attachment = remoteAttachmentRef.current
      const load = remoteLoad
      if (!attachment || !load) {
        setView({ identity, phase: 'failed' })
      } else {
        void load(attachment, controller?.signal).then((blob) => {
          if (!controller?.signal.aborted) publish(blob)
        }).catch(() => {
          if (!controller?.signal.aborted) setView({ identity, phase: 'failed' })
        })
      }
    }

    return () => {
      controller?.abort()
      release()
      if (releaseRef.current?.release === release) releaseRef.current = undefined
    }
  }, [identity, localBlob, nearby, remoteIdentity, remoteLoad, sourceKind])

  const currentView = view.identity === identity
    ? view
    : { identity, phase: nearby ? 'loading' : 'idle' } satisfies ThumbnailView
  const rootClassName = className
    ? `${styles.thumbnail} ${className}`
    : styles.thumbnail

  return (
    <span
      ref={rootRef}
      className={rootClassName}
      data-state={currentView.phase}
      aria-busy={currentView.phase === 'loading'}
    >
      {currentView.phase === 'ready' && currentView.objectURL ? (
        <img
          key={currentView.objectURL}
          src={currentView.objectURL}
          alt={alt}
          decoding="async"
          loading="lazy"
          draggable={false}
          onError={() => {
            const failedObjectURL = currentView.objectURL
            const ownership = releaseRef.current
            if (!failedObjectURL || ownership?.objectURL !== failedObjectURL) return
            ownership.release()
            releaseRef.current = undefined
            setView((current) => current.identity === identity && current.objectURL === failedObjectURL
              ? { identity, phase: 'failed' }
              : current)
          }}
        />
      ) : (
        <span className={styles.placeholder} role="img" aria-label={alt}>
          {currentView.phase === 'loading'
            ? <LoaderCircle className={styles.spinner} size={16} aria-hidden="true" />
            : currentView.phase === 'failed'
              ? <ImageOff size={17} aria-hidden="true" />
              : <ImageIcon size={17} aria-hidden="true" />}
        </span>
      )}
    </span>
  )
}

type ThumbnailView = {
  identity: Blob | string
  phase: 'idle' | 'loading' | 'ready' | 'failed'
  objectURL?: string
}
