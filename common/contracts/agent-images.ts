const imageReferencePrefix = 'termous-image://tool/'

// 引用只用于会话内查找，不是网络地址或可访问的本地路径。
export function agentToolImageReference(toolCallID: string, contentIndex: number): string | undefined {
  if (!toolCallID || toolCallID === '.' || toolCallID === '..' || toolCallID.length > 512
    || !Number.isSafeInteger(contentIndex) || contentIndex < 0) return undefined
  try {
    const encodedID = encodeURIComponent(toolCallID).replace(/[!'()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    return `${imageReferencePrefix}${encodedID}/${contentIndex}`
  } catch {
    return undefined
  }
}

export function isAgentToolImageReference(value: string): boolean {
  if (!value.startsWith(imageReferencePrefix)) return false
  const match = /^([^/]+)\/(0|[1-9]\d*)$/u.exec(value.slice(imageReferencePrefix.length))
  if (!match) return false
  try {
    return agentToolImageReference(decodeURIComponent(match[1]!), Number(match[2])) === value
  } catch {
    return false
  }
}

export function isAgentDisplayImageMIMEType(value: unknown): value is string {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif'
}
