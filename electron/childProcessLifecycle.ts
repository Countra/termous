export interface ChildProcessExitObservable {
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  once(event: 'exit', listener: () => void): unknown
  removeListener(event: 'exit', listener: () => void): unknown
}

export interface ChildProcessTerminationObservable extends ChildProcessExitObservable {
  pid?: number
  kill(signal?: NodeJS.Signals | number): boolean
}

export interface StopOwnedChildProcessOptions {
  gracefulTimeoutMs: number
  forceTimeoutMs: number
}

export function hasChildProcessExited(child: ChildProcessExitObservable) {
  return child.exitCode !== null || child.signalCode !== null
}

export function clearObservedChildProcess<T>(
  current: T | null,
  observed: T,
) {
  return current === observed ? null : current
}

export function waitForChildProcessExit(
  child: ChildProcessExitObservable,
  timeoutMs: number,
): Promise<boolean> {
  if (hasChildProcessExited(child)) {
    return Promise.resolve(true)
  }
  return new Promise<boolean>((resolve) => {
    let settled = false
    let timeout: NodeJS.Timeout | null = null
    const finish = (exited: boolean) => {
      if (settled) {
        return
      }
      settled = true
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
      child.removeListener('exit', onExit)
      resolve(exited)
    }
    const onExit = () => finish(true)

    child.once('exit', onExit)
    timeout = setTimeout(() => finish(false), Math.max(0, timeoutMs))
    // 进程可能在首次检查和监听器注册之间退出，注册后必须再次确认。
    if (hasChildProcessExited(child)) {
      finish(true)
    }
  })
}

export async function stopOwnedChildProcess(
  child: ChildProcessTerminationObservable,
  {
    gracefulTimeoutMs,
    forceTimeoutMs,
  }: StopOwnedChildProcessOptions,
) {
  if (hasChildProcessExited(child)) {
    return
  }
  if (!child.pid) {
    // spawn 失败时不会产生可终止的系统进程，此时可以安全释放对应引用。
    return
  }

  try {
    child.kill()
  } catch {
    // 优雅信号失败后仍需等待并升级为强制终止，最终以退出状态为准。
  }
  if (await waitForChildProcessExit(child, gracefulTimeoutMs)) {
    return
  }

  try {
    child.kill('SIGKILL')
  } catch {
    // 强制信号异常也不能视为退出，下面会再次确认真实进程状态。
  }
  if (await waitForChildProcessExit(child, forceTimeoutMs)) {
    return
  }

  throw new Error('Termous Core 进程无法终止')
}
