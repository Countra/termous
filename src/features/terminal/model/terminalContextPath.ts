import { normalizeRemotePosixPath } from '#shared/path'
import type { TerminalPathContextTarget } from './terminalContextTarget.ts'

export function resolveTerminalContextPath(
  target: TerminalPathContextTarget,
  confirmedPath?: string,
): string | null {
  if (target.copyOnly || target.resolution === 'home_relative') {
    return null
  }
  if (target.resolution === 'absolute') {
    return normalizeRemotePosixPath(target.value)
  }
  const basePath = confirmedPath ? normalizeRemotePosixPath(confirmedPath) : null
  if (!basePath) {
    return null
  }
  return normalizeRemotePosixPath(`${basePath}/${target.value}`)
}
