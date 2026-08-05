import type { AliasSyncTask } from '../../types/domain'

export const ALIAS_SYNC_TERMINAL_WAIT_TIMEOUT_MS = 15_000

export interface AliasSyncTerminalWaiter {
  resolve: (task: AliasSyncTask) => void
  reject: (error: Error) => void
  timer?: ReturnType<typeof setTimeout>
}

export type AliasSyncTerminalWaiterMap = Map<string, Set<AliasSyncTerminalWaiter>>

export function waitForAliasSyncTerminal(
  waitersByTask: AliasSyncTerminalWaiterMap,
  taskId: string,
  timeoutError: Error,
  timeoutMs = ALIAS_SYNC_TERMINAL_WAIT_TIMEOUT_MS,
) {
  return new Promise<AliasSyncTask>((resolve, reject) => {
    const settle = (waiter: AliasSyncTerminalWaiter, callback: () => void) => {
      if (!removeAliasSyncTerminalWaiter(waitersByTask, taskId, waiter)) {
        return
      }
      callback()
    }
    const waiter: AliasSyncTerminalWaiter = {
      resolve: (task) => settle(waiter, () => resolve(task)),
      reject: (error) => settle(waiter, () => reject(error)),
    }
    const waiters = waitersByTask.get(taskId) ?? new Set<AliasSyncTerminalWaiter>()
    waiters.add(waiter)
    waitersByTask.set(taskId, waiters)
    waiter.timer = setTimeout(() => waiter.reject(timeoutError), timeoutMs)
  })
}

export function resolveAliasSyncTerminalWaiters(
  waitersByTask: AliasSyncTerminalWaiterMap,
  task: AliasSyncTask,
) {
  const waiters = [...(waitersByTask.get(task.id) ?? [])]
  waiters.forEach((waiter) => waiter.resolve(task))
}

export function rejectAliasSyncTerminalWaiters(
  waitersByTask: AliasSyncTerminalWaiterMap,
  taskId: string,
  error: Error,
) {
  const waiters = [...(waitersByTask.get(taskId) ?? [])]
  waiters.forEach((waiter) => waiter.reject(error))
}

export function rejectAllAliasSyncTerminalWaiters(
  waitersByTask: AliasSyncTerminalWaiterMap,
  error: Error,
) {
  const taskIds = [...waitersByTask.keys()]
  taskIds.forEach((taskId) => rejectAliasSyncTerminalWaiters(waitersByTask, taskId, error))
}

function removeAliasSyncTerminalWaiter(
  waitersByTask: AliasSyncTerminalWaiterMap,
  taskId: string,
  waiter: AliasSyncTerminalWaiter,
) {
  const waiters = waitersByTask.get(taskId)
  if (!waiters?.delete(waiter)) {
    return false
  }
  if (waiters.size === 0) {
    waitersByTask.delete(taskId)
  }
  if (waiter.timer !== undefined) {
    clearTimeout(waiter.timer)
    waiter.timer = undefined
  }
  return true
}
