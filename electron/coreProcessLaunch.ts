import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from 'node:child_process'
import path from 'node:path'
import { CoreStartupEventParser, type CoreStartupEvent } from './coreStartupProtocol.ts'
import { isCoreBindFailure } from './coreStartupState.ts'
import {
  hasChildProcessExited,
  waitForChildProcessExit,
  type ChildProcessExitObservable,
} from './childProcessLifecycle.ts'

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
  startupInstance?: string
  onStartupEvent?: (event: CoreStartupEvent) => void
  onStartupProtocolError?: (reason: 'invalid_message' | 'oversized_message') => void
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
    startupInstance,
    onStartupEvent,
    onStartupProtocolError,
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
      TERMOUS_STARTUP_PROTOCOL: startupInstance ? '1' : '',
      TERMOUS_STARTUP_INSTANCE: startupInstance ?? '',
    },
    windowsHide: true,
    stdio: 'pipe',
  })

  // 两条输出管道始终消费，状态协议只接受所属 Core 的结构化事件。
  child.stdout.on('data', () => undefined)
  const parser = new CoreStartupEventParser((event) => onStartupEvent?.(event), onStartupProtocolError)
  child.stderr.on('data', (chunk: Buffer | string) => parser.write(chunk))
  child.stderr.once('end', () => parser.end())
  child.stderr.once('close', () => parser.end())
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
      if (!isCoreBindFailure(error)) {
        return { status: 'failed', lastError }
      }
    }
  }
  return { status: 'failed', lastError }
}

export function waitForManagedCoreStartupOutput(
  child: Pick<ChildProcessWithoutNullStreams, 'stderr'>,
  timeoutMs = 500,
) {
  if (child.stderr.readableEnded || child.stderr.destroyed) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      child.stderr.removeListener('end', finish)
      child.stderr.removeListener('close', finish)
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    child.stderr.once('end', finish)
    child.stderr.once('close', finish)
  })
}

export async function waitForManagedCoreFailureExit(
  child: ChildProcessExitObservable,
  isStopping: () => boolean,
  timeoutMs = 12_000,
) {
  const deadline = Date.now() + timeoutMs
  while (!hasChildProcessExited(child) && !isStopping()) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return false
    if (await waitForChildProcessExit(child, Math.min(remaining, 250))) return true
  }
  return hasChildProcessExited(child)
}
