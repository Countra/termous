import path from 'node:path'
import type { DesktopChannel } from '#common/desktop-identity'

export function corePolicy(channel: DesktopChannel, environment: NodeJS.ProcessEnv, platform: NodeJS.Platform, executable: string, root: string) {
  const development = channel === 'development'
  const binary = platform === 'win32' ? 'termous-core.exe' : 'termous-core'
  return {
    external: development && (Boolean(environment.TERMOUS_API_BASE_URL) || !environment.TERMOUS_CORE_PATH),
    port: development ? 8122 : 8152,
    binary: development
      ? environment.TERMOUS_CORE_PATH || path.join(root, 'build', 'core', binary)
      : path.resolve(path.dirname(executable), platform === 'darwin' ? '..' : '.', binary),
    apiBaseUrl: development ? environment.TERMOUS_API_BASE_URL || 'http://127.0.0.1:8122' : '',
    apiToken: development ? environment.TERMOUS_API_TOKEN || 'dev-token' : '',
    environment: development
      ? { ...environment, TERMOUS_DATA_DIR: environment.TERMOUS_DATA_DIR || path.resolve(root, '../dev-data/.termous') }
      : environment,
  }
}
