import { useCallback, useRef } from 'react'
import type { AgentAttachment } from '#entities/agent'
import { ImageThumbnail } from '#shared/ui'

export type AgentAttachmentThumbnailSource =
  | { kind: 'local'; blob: Blob }
  | { kind: 'content'; key: string; load: (signal?: AbortSignal) => Promise<Blob> }
  | { kind: 'remote'; attachment: AgentAttachment; load: (attachment: AgentAttachment, signal?: AbortSignal) => Promise<Blob> }

export function AgentAttachmentThumbnail({ source, alt, className }: {
  source: AgentAttachmentThumbnailSource
  alt: string
  className?: string
}) {
  const attachment = source.kind === 'remote' ? source.attachment : undefined
  const load = source.kind === 'remote' ? source.load : undefined
  const attachmentRef = useRef(attachment)
  attachmentRef.current = attachment
  const loadImage = useCallback((signal?: AbortSignal) => {
    if (!attachmentRef.current || !load) return Promise.reject(new Error('AGENT_ATTACHMENT_UNAVAILABLE'))
    return load(attachmentRef.current, signal)
  }, [load])
  const contentLoad = useRef(source.kind === 'content' ? source.load : undefined)
  contentLoad.current = source.kind === 'content' ? source.load : undefined
  const loadContent = useCallback((signal?: AbortSignal) => contentLoad.current?.(signal)
    ?? Promise.reject(new Error('AGENT_ATTACHMENT_UNAVAILABLE')), [])
  return <ImageThumbnail alt={alt} className={className} source={source.kind === 'local' ? source : source.kind === 'content' ? {
    kind: 'remote', key: source.key, load: loadContent,
  } : {
    kind: 'remote', key: `${source.attachment.id}:${source.attachment.revision}`, load: loadImage,
  }} />
}
