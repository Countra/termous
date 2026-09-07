import type { AgentAttachment } from '#entities/agent'

export const agentAttachmentLimits = {
  maximumCount: 8,
  maximumTextBytes: 256 * 1024,
  maximumTextTotalBytes: 512 * 1024,
  maximumImageBytes: 10 * 1024 * 1024,
  maximumImageTotalBytes: 20 * 1024 * 1024,
} as const

const unspecifiedMIMETypes = new Set(['', 'application/octet-stream'])

export type AgentAttachmentKind = 'text' | 'image'

export interface AgentAttachmentSelection {
  file: File
  kind: AgentAttachmentKind
}

export class AgentAttachmentSelectionError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'AgentAttachmentSelectionError'
    this.code = code
  }
}

export async function validateAgentAttachmentSelection(
  existing: readonly Pick<AgentAttachment, 'kind' | 'size_bytes'>[],
  files: readonly File[],
): Promise<AgentAttachmentSelection[]> {
  if (existing.length + files.length > agentAttachmentLimits.maximumCount) {
    throw new AgentAttachmentSelectionError('AGENT_ATTACHMENT_LIMIT_COUNT')
  }
  const selections: AgentAttachmentSelection[] = []
  for (const file of files) {
    const declaredMIMEType = file.type.trim().toLocaleLowerCase()
    const detectedImageMIMEType = detectImageMIMEType(new Uint8Array(await file.slice(0, 12).arrayBuffer()))
    if (declaredMIMEType.startsWith('image/') && !detectedImageMIMEType) {
      throw new AgentAttachmentSelectionError('AGENT_ATTACHMENT_IMAGE_SIGNATURE')
    }
    if (detectedImageMIMEType && !unspecifiedMIMETypes.has(declaredMIMEType) && declaredMIMEType !== detectedImageMIMEType) {
      throw new AgentAttachmentSelectionError('AGENT_ATTACHMENT_IMAGE_SIGNATURE')
    }
    const kind = detectedImageMIMEType ? 'image' : 'text'
    const maximum = kind === 'image'
      ? agentAttachmentLimits.maximumImageBytes
      : agentAttachmentLimits.maximumTextBytes
    if (file.size <= 0 || file.size > maximum) {
      throw new AgentAttachmentSelectionError(
        kind === 'image' ? 'AGENT_ATTACHMENT_LIMIT_IMAGE' : 'AGENT_ATTACHMENT_LIMIT_TEXT',
      )
    }
    if (kind === 'text') {
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
        if (text.includes('\u0000')) throw new Error('NUL')
      } catch {
        throw new AgentAttachmentSelectionError('AGENT_ATTACHMENT_TEXT_ENCODING')
      }
    }
    const canonicalFile = detectedImageMIMEType && declaredMIMEType !== detectedImageMIMEType
      ? new File([file], file.name, { type: detectedImageMIMEType, lastModified: file.lastModified })
      : file
    selections.push({ file: canonicalFile, kind })
  }
  validateAggregateLimits(existing, selections)
  return selections
}

function detectImageMIMEType(bytes: Uint8Array) {
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp'
  }
  return undefined
}

export function isAgentImageAttachment(value: Pick<AgentAttachment, 'kind'>) {
  return value.kind === 'image'
}

function validateAggregateLimits(
  existing: readonly Pick<AgentAttachment, 'kind' | 'size_bytes'>[],
  selections: readonly AgentAttachmentSelection[],
) {
  const values = [
    ...existing.map((item) => ({
      kind: isAgentImageAttachment(item) ? 'image' as const : 'text' as const,
      size: item.size_bytes,
    })),
    ...selections.map((item) => ({ kind: item.kind, size: item.file.size })),
  ]
  const textBytes = values.filter(({ kind }) => kind === 'text').reduce((sum, item) => sum + item.size, 0)
  const imageBytes = values.filter(({ kind }) => kind === 'image').reduce((sum, item) => sum + item.size, 0)
  if (textBytes > agentAttachmentLimits.maximumTextTotalBytes) {
    throw new AgentAttachmentSelectionError('AGENT_ATTACHMENT_LIMIT_TEXT_TOTAL')
  }
  if (imageBytes > agentAttachmentLimits.maximumImageTotalBytes) {
    throw new AgentAttachmentSelectionError('AGENT_ATTACHMENT_LIMIT_IMAGE_TOTAL')
  }
}
