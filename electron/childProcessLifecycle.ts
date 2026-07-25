export interface ChildProcessExitObservable {
  exitCode: number | null
  once(event: 'exit', listener: () => void): unknown
  removeListener(event: 'exit', listener: () => void): unknown
}

export function waitForChildProcessExit(
  child: ChildProcessExitObservable,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null) {
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
    if (child.exitCode !== null) {
      finish(true)
    }
  })
}
