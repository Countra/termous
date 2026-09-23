import type { CoreRuntimeProbe } from './coreRuntimeProbe'

export type ShutdownOutcome =
  | { status: 'stopped' }
  | { status: 'blocked' | 'failed'; message: string }

export interface ShutdownDependencies {
  request(): Promise<boolean>
  probe(): Promise<CoreRuntimeProbe | null>
  exited(): boolean
  wait(ms: number): Promise<unknown>
  now(): number
  committed(): void
  expectedPID?: number
}

// 准备退出期间保留窗口和心跳；超时只返回失败，绝不据此强杀 Core。
export async function awaitCoreShutdown(dependencies: ShutdownDependencies, timeoutMs = 45_000): Promise<ShutdownOutcome> {
  const deadline = dependencies.now() + timeoutMs
  try {
    if (!await dependencies.request()) return { status: 'failed', message: 'Core rejected the shutdown request.' }
  } catch {
    // 请求可能已被接受但响应丢失，必须继续核实进程或运行时状态。
  }
  while (dependencies.now() < deadline) {
    if (dependencies.exited()) return { status: 'stopped' }
    try {
      const status = await dependencies.probe()
      if (status && (dependencies.expectedPID === undefined || status.pid === dependencies.expectedPID)) {
        if (status.shutdown_phase === 'blocked') {
          return { status: 'blocked', message: status.shutdown_error || 'Pending file changes could not be saved.' }
        }
        if (status.shutdown_phase === 'closing' || status.shutdown_phase === 'closed') dependencies.committed()
      }
    } catch {
      // HTTP 停止后仍等待所属进程真正退出。
    }
    await dependencies.wait(200)
  }
  return dependencies.exited() ? { status: 'stopped' } : { status: 'failed', message: 'Core has not completed shutdown. The application remains open.' }
}
