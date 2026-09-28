import type { ForwardEvent, ForwardInstance, ForwardStartRequest } from '#entities/forward'
import {
  isForwardStartSettledStatus,
  reconcileForwardsAfterRestartFailure,
  restartForwardInstance,
  selectForwardStartSnapshot,
} from '#features/forwards'
import type { ForwardCommandGateway } from '../api/runtimeGatewayContracts'
import {
  FORWARD_START_COMPLETION_TIMEOUT_MS,
  rememberForwardEventSnapshot,
  settleForwardStartCompletion,
  shouldEmitForwardError,
  shouldRemoveForward,
  syncForwardAfterStart,
  upsertForward,
  visibleForwards,
  type ForwardStartCompletionWaiter,
} from '../model/forwardRuntimeState'
import { bumpSessionRevision } from '../model/appDataState'
import type { SetAppData, SetRuntimeState } from '../model/runtimeTypes'

interface ForwardCommandDependencies {
  api: ForwardCommandGateway
  forwards: ForwardInstance[]
  setData: SetAppData
  setForwardErrorEvent: SetRuntimeState<ForwardEvent | null>
  forwardReloadChangeTrackers: Set<Set<string>>
  forwardStartCompletionWaiters: Map<string, ForwardStartCompletionWaiter>
  forwardEventRevisions: Map<string, number>
  forwardEventSnapshots: Map<string, ForwardInstance>
}

export function createForwardCommands({
  api,
  forwards,
  setData,
  setForwardErrorEvent,
  forwardReloadChangeTrackers,
  forwardStartCompletionWaiters,
  forwardEventRevisions,
  forwardEventSnapshots,
}: ForwardCommandDependencies) {
  function applyForwardSnapshot(forward: ForwardInstance, replacedForwardId = '', deleted = false) {
    // 捕获本次变更影响的在途重载；即使 React 延后执行更新，也能保留其请求检查点。
    const trackers = [...forwardReloadChangeTrackers]
    for (const changedIds of trackers) {
      changedIds.add(forward.id)
      if (replacedForwardId) changedIds.add(replacedForwardId)
    }
    setData((current) => {
      const retained = current.forwards.filter((item) => item.id !== replacedForwardId)
      const next = deleted || shouldRemoveForward(forward)
        ? retained.filter((item) => item.id !== forward.id)
        : upsertForward(retained, forward)
      const retainedIds = new Set(next.map((item) => item.id))
      for (const item of current.forwards) {
        if (!retainedIds.has(item.id)) {
          for (const changedIds of trackers) changedIds.add(item.id)
        }
      }
      return { ...current, forwards: next }
    })
  }

  function resolveForwardStartCompletion(
    forwardId: string,
    forward: ForwardInstance | null,
  ) {
    settleForwardStartCompletion(
      forwardStartCompletionWaiters,
      forwardEventSnapshots,
      forwardEventRevisions,
      forwardId,
      forward,
    )
  }

  function registerStartedForward(
    forward: ForwardInstance,
    replacedForwardId = '',
  ) {
    const latestForward = selectForwardStartSnapshot(
      forward,
      forwardEventSnapshots.get(forward.id) ?? null,
    )
    applyForwardSnapshot(latestForward, replacedForwardId)
    const previousWaiter = forwardStartCompletionWaiters.get(forward.id)
    forwardStartCompletionWaiters.delete(forward.id)
    if (previousWaiter) {
      window.clearTimeout(previousWaiter.cleanupTimer)
      previousWaiter.resolve(null)
    }
    let waiter!: ForwardStartCompletionWaiter
    const completion = new Promise<ForwardInstance | null>((resolve) => {
      waiter = {
        resolve,
        registeredAt: performance.now(),
        cleanupTimer: 0,
      }
    })
    waiter.cleanupTimer = window.setTimeout(() => {
      if (forwardStartCompletionWaiters.get(forward.id) === waiter) {
        resolveForwardStartCompletion(forward.id, null)
      }
    }, FORWARD_START_COMPLETION_TIMEOUT_MS)
    forwardStartCompletionWaiters.set(forward.id, waiter)
    if (isForwardStartSettledStatus(latestForward.status)) {
      resolveForwardStartCompletion(forward.id, latestForward)
      return completion
    }
    void syncForwardAfterStart(
      api,
      forward.id,
      (nextForward) => {
        const shouldRemove = shouldRemoveForward(nextForward)
        if (shouldRemove) {
          setForwardErrorEvent({
            type: 'error',
            forward: nextForward,
            message: nextForward.last_error || nextForward.status_message,
          })
        }
        applyForwardSnapshot(nextForward)
      },
      () => forwardEventRevisions.get(forward.id) ?? 0,
      () => forwardStartCompletionWaiters.has(forward.id),
    ).then((settledForward) => {
      if (settledForward !== undefined) {
        resolveForwardStartCompletion(forward.id, settledForward)
      }
    }).catch((error) => {
      console.error('同步端口转发启动终态失败', error)
    })
    return completion
  }

  async function reconcileRestartFailure(
    replacedForwardId: string,
    stopConfirmed: boolean,
  ) {
    try {
      const authoritativeForwards = await api.forwards()
      setData((current) => ({
        ...current,
        forwards: reconcileForwardsAfterRestartFailure(
          current.forwards,
          visibleForwards(authoritativeForwards ?? []),
          replacedForwardId,
          stopConfirmed,
        ),
      }))
    } catch (error) {
      console.error('端口转发重启失败后的状态对账失败', error)
      setData((current) => ({
        ...current,
        forwards: reconcileForwardsAfterRestartFailure(
          current.forwards,
          null,
          replacedForwardId,
          stopConfirmed,
        ),
      }))
    }
  }

  return {
    async startForward(input: ForwardStartRequest) {
      const forward = await api.startForward(input)
      void registerStartedForward(forward)
      return forward
    },
    async restartForward(id: string) {
      const currentForward = forwards.find((forward) => forward.id === id)
      if (!currentForward) {
        throw new Error('端口转发任务不存在')
      }
      let stopConfirmed = false
      try {
        const replacement = await restartForwardInstance(
          currentForward,
          async (forwardId) => {
            await api.stopForward(forwardId)
            stopConfirmed = true
          },
          (input) => api.startForward(input),
        )
        const completion = registerStartedForward(replacement, currentForward.id)
        return { forward: replacement, completion }
      } catch (error) {
        await reconcileRestartFailure(id, stopConfirmed)
        throw error
      }
    },
    async stopForward(id: string) {
      await api.stopForward(id)
      resolveForwardStartCompletion(id, null)
      for (const changedIds of forwardReloadChangeTrackers) changedIds.add(id)
      setData((current) => ({
        ...current,
        forwards: current.forwards.filter((forward) => forward.id !== id),
      }))
    },
    updateForward(event: ForwardEvent) {
      if (forwardStartCompletionWaiters.has(event.forward.id)) {
        bumpSessionRevision(forwardEventRevisions, event.forward.id)
      }
      rememberForwardEventSnapshot(forwardEventSnapshots, event.forward)
      resolveForwardStartCompletion(event.forward.id, event.forward)
      if (shouldEmitForwardError(event)) {
        setForwardErrorEvent(event)
      }
      applyForwardSnapshot(event.forward, '', event.type === 'deleted')
    },
  }
}
