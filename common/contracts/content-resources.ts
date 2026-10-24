export interface ContentResourceReference {
  resource_id: string
  kind: 'image' | 'text' | 'file'
  mime_type: string
  size_bytes: number
  sha256: string
}

export interface ImageResourceReference extends ContentResourceReference {
  kind: 'image'
  image: { width: number; height: number }
}

export interface TextResourceReference extends ContentResourceReference {
  kind: 'text'
}

export function isTextResourceReference(value: unknown): value is TextResourceReference {
  if (typeof value !== 'object' || value === null) return false
  const ref = value as Record<string, unknown>
  return typeof ref.resource_id === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(ref.resource_id)
    && ref.kind === 'text' && typeof ref.mime_type === 'string' && ref.mime_type.length > 0 && ref.mime_type.length <= 128
    && Number.isSafeInteger(ref.size_bytes) && Number(ref.size_bytes) > 0 && Number(ref.size_bytes) <= 256 * 1024
    && typeof ref.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(ref.sha256) && ref.image === undefined
}

export function isImageResourceReference(value: unknown): value is ImageResourceReference {
  if (typeof value !== 'object' || value === null) return false
  const ref = value as Record<string, unknown>
  const size = ref.image as Record<string, unknown> | undefined
  return typeof ref.resource_id === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(ref.resource_id)
    && ref.kind === 'image' && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(String(ref.mime_type))
    && Number.isSafeInteger(ref.size_bytes) && Number(ref.size_bytes) > 0 && Number(ref.size_bytes) <= 10 * 1024 * 1024
    && typeof ref.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(ref.sha256)
    && !!size && Number.isSafeInteger(size.width) && Number.isSafeInteger(size.height)
    && Number(size.width) > 0 && Number(size.height) > 0 && Number(size.width) * Number(size.height) <= 64 * 1024 * 1024
}
