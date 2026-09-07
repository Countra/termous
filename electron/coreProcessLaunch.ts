import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from 'node:child_process'
import path from 'node:path'

export interface ManagedCoreArgumentsOptions {
  addr: string
  packaged: boolean
  logDirectory?: string
}

export interface ManagedCoreLaunchOptions extends ManagedCoreArgumentsOptions {
  binaryPath: string
  token: string
  environment: NodeJS.ProcessEnv
  parentPid: number
}

export type ManagedCoreSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams

export interface ManagedCorePortAttemptsOptions {
  portStart: number
  maxPortSwitches: number
  isStopping: () => boolean
  start: (port: number) => Promise<void>
  stopFailedAttempt: () => Promise<void>
}

export type ManagedCorePortAttemptsResult =
  | { status: 'started'; port: number }
  | { status: 'cancelled' }
  | { status: 'failed'; lastError: unknown }

export function buildManagedCoreArguments({
  addr,
  packaged,
  logDirectory,
}: ManagedCoreArgumentsOptions) {
  const args = ['--addr', addr]
  if (packaged && logDirectory) {
    args.push('--log-dir', logDirectory)
  }
  return args
}

export function spawnManagedCoreProcess(
  {
    binaryPath,
    addr,
    token,
    packaged,
    logDirectory,
    environment,
    parentPid,
  }: ManagedCoreLaunchOptions,
  spawnProcess: ManagedCoreSpawn = spawn,
) {
  const child = spawnProcess(binaryPath, buildManagedCoreArguments({
    addr,
    packaged,
    logDirectory,
  }), {
    cwd: path.dirname(binaryPath),
    env: {
      ...environment,
      TERMOUS_ADDR: addr,
      TERMOUS_API_TOKEN: token,
      TERMOUS_REQUIRE_HEARTBEAT: '1',
      TERMOUS_HEARTBEAT_TIMEOUT: '30s',
      TERMOUS_PARENT_PID: String(parentPid),
    },
    windowsHide: true,
    stdio: 'pipe',
  })

  // 托管进程的输出不展示，但必须持续消费，避免管道写满后阻塞 Core。
  child.stdout.on('data', () => undefined)
  child.stderr.on('data', () => undefined)
  return child
}

export async function runManagedCorePortAttempts({
  portStart,
  maxPortSwitches,
  isStopping,
  start,
  stopFailedAttempt,
}: ManagedCorePortAttemptsOptions): Promise<ManagedCorePortAttemptsResult> {
  let lastError: unknown = null
  for (let offset = 0; offset <= maxPortSwitches; offset += 1) {
    if (isStopping()) {
      return { status: 'cancelled' }
    }
    const port = portStart + offset
    try {
      await start(port)
      return { status: 'started', port }
    } catch (error) {
      lastError = error
      // 清理失败必须向上传播，禁止在旧进程仍存活时继续尝试新端口。
      await stopFailedAttempt()
      if (isStopping()) {
        return { status: 'cancelled' }
      }
    }
  }
  return { status: 'failed', lastError }
}
