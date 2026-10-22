import path from 'node:path'
import { sanitizedWorkerEnvironment } from '../../electron/agent/host/workerEnvironment.ts'

// 只组装隔离 Worker 验收进程；不与正式应用或其他 Electron 入口共用。
export function workerAcceptanceLaunchOptions(output, platform = process.platform, source = process.env) {
  const environment = sanitizedWorkerEnvironment(source)
  environment.XDG_CACHE_HOME = path.join(output, 'cache')
  for (const name of ['DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']) {
    if (source[name]) environment[name] = source[name]
  }
  // Linux CI/容器可能没有可用的 Chromium sandbox，须由验收调用方显式选择。
  const args = platform === 'linux' && source.TERMOUS_ELECTRON_ACCEPTANCE_NO_SANDBOX === '1'
    ? ['--no-sandbox'] : []
  return { args, environment }
}
