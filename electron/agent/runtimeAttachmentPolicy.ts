import { isRecord } from './protocol.ts'

export const maximumRuntimeAttachments = 8
export const maximumTextAttachmentBytes = 256 * 1024
export const maximumTextAttachmentTotalBytes = 512 * 1024
export const maximumImageAttachmentBytes = 10 * 1024 * 1024
export const maximumImageAttachmentTotalBytes = 20 * 1024 * 1024

const supportedImageMIMETypes = new Set(['image/png', 'image/jpeg', 'image/webp'])
const supportedApplicationTextMIMETypes = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-javascript',
  'application/yaml',
  'application/x-yaml',
])

export interface RuntimeMessageAttachment {
  id: string
  kind: 'text' | 'image'
  mime_type: string
  content_base64: string
}

export function isRuntimeMessageAttachmentList(
  value: unknown,
): value is RuntimeMessageAttachment[] {
  if (!Array.isArray(value) || value.length > maximumRuntimeAttachments) {
    return false
  }
  const ids = new Set<string>()
  let textBytes = 0
  let imageBytes = 0
  for (const attachment of value) {
    if (!isRuntimeMessageAttachment(attachment) || ids.has(attachment.id)) {
      return false
    }
    ids.add(attachment.id)
    const size = decodedBase64Length(attachment.content_base64)
    if (attachment.kind === 'text') {
      textBytes += size
      if (size > maximumTextAttachmentBytes || textBytes > maximumTextAttachmentTotalBytes) {
        return false
      }
      continue
    }
    imageBytes += size
    if (size > maximumImageAttachmentBytes || imageBytes > maximumImageAttachmentTotalBytes) {
      return false
    }
  }
  return true
}

export function decodeRuntimeAttachment(attachment: RuntimeMessageAttachment) {
  if (!validRuntimeAttachmentMIME(attachment)
    || !validBase64(attachment.content_base64)) {
    throw new Error('AGENT_RUNTIME_ATTACHMENT_INVALID')
  }
  const bytes = Buffer.from(attachment.content_base64, 'base64')
  if (bytes.byteLength === 0
    || bytes.toString('base64') !== attachment.content_base64
    || (attachment.kind === 'image' && !validRuntimeImageMagic(bytes, attachment.mime_type))) {
    throw new Error('AGENT_RUNTIME_ATTACHMENT_INVALID')
  }
  return bytes
}

export function validRuntimeAttachmentMIME(attachment: RuntimeMessageAttachment) {
  return validRuntimeAttachmentMIMEValue(attachment.kind, attachment.mime_type)
}

function isRuntimeMessageAttachment(value: unknown): value is RuntimeMessageAttachment {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && value.id.length <= 128
    && /^[A-Za-z0-9_-]+$/u.test(value.id)
    && (value.kind === 'text' || value.kind === 'image')
    && typeof value.mime_type === 'string'
    && value.mime_type.length > 0
    && value.mime_type.length <= 128
    && validRuntimeAttachmentMIMEValue(value.kind, value.mime_type)
    && typeof value.content_base64 === 'string'
    && validBase64(value.content_base64)
    && value.content_base64.length <= maxRuntimeAttachmentBase64Length(value.kind)
}

function validRuntimeAttachmentMIMEValue(
  kind: RuntimeMessageAttachment['kind'],
  mimeType: string,
) {
  if (kind === 'image') {
    return supportedImageMIMETypes.has(mimeType)
  }
  return /^text\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(mimeType)
    || supportedApplicationTextMIMETypes.has(mimeType)
}

function validBase64(value: string) {
  return value.length > 0
    && value.length % 4 === 0
    && /^[A-Za-z0-9+/]*={0,2}$/u.test(value)
}

function decodedBase64Length(value: string) {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return value.length / 4 * 3 - padding
}

function maxRuntimeAttachmentBase64Length(kind: RuntimeMessageAttachment['kind']) {
  const maximumBytes = kind === 'text' ? maximumTextAttachmentBytes : maximumImageAttachmentBytes
  return Math.ceil(maximumBytes / 3) * 4
}

function validRuntimeImageMagic(bytes: Uint8Array, mimeType: string) {
  if (mimeType === 'image/png') {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    return bytes.byteLength >= signature.byteLength
      && Buffer.from(bytes.subarray(0, signature.byteLength)).equals(signature)
  }
  if (mimeType === 'image/jpeg') {
    return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
  return mimeType === 'image/webp'
    && bytes.byteLength >= 12
    && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF'
    && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
}
