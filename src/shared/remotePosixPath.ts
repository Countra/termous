export class InvalidRemotePosixPathError extends Error {
  readonly value: string

  constructor(value: string) {
    super('Invalid absolute remote POSIX path')
    this.name = 'InvalidRemotePosixPathError'
    this.value = value
  }
}

/**
 * 规范化远端绝对 POSIX 路径。
 *
 * 路径段内容按字面值保留；这里只折叠空段、`.` 和 `..`，不会把反斜杠
 * 当作分隔符，也不会裁剪路径段两侧的空格。
 */
export function normalizeRemotePosixPath(value: string): string | null {
  if (
    !value.startsWith('/') ||
    containsControlCharacter(value) ||
    containsUnpairedSurrogate(value)
  ) {
    return null
  }

  const segments: string[] = []
  for (const segment of value.split('/')) {
    if (segment === '' || segment === '.') {
      continue
    }
    if (segment === '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments.length > 0 ? `/${segments.join('/')}` : '/'
}

export function requireRemotePosixPath(value: string): string {
  const normalized = normalizeRemotePosixPath(value)
  if (normalized === null) {
    throw new InvalidRemotePosixPathError(value)
  }
  return normalized
}

function containsControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      return true
    }
  }
  return false
}

function containsUnpairedSurrogate(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) {
        return true
      }
      index += 1
      continue
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}
