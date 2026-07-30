import { useCallback, useEffect, useRef, useState } from 'react'
import type { ForwardInstance } from '../../types/domain'
import {
  emptyForwardThroughput,
  FORWARD_THROUGHPUT_PUBLISH_MS,
  ForwardThroughputSampler,
  resolveForwardThroughputNextWakeAt,
  resolveForwardThroughputPublishAt,
  type ForwardThroughput,
} from './forwardThroughput'

interface ForwardThroughputState {
  identity: string
  value: ForwardThroughput
}

interface ScheduledPublish {
  deadline: number
  generation: number
  handle: number
}

export function useForwardThroughput(forward: ForwardInstance, enabled = true) {
  const samplerRef = useRef<ForwardThroughputSampler | null>(null)
  const latestValueRef = useRef(emptyForwardThroughput())
  const publishedValueRef = useRef(emptyForwardThroughput())
  const identityRef = useRef('')
  const generationRef = useRef(0)
  const nextPublishAtRef = useRef(0)
  const publishTimerRef = useRef<ScheduledPublish | null>(null)
  const [state, setState] = useState<ForwardThroughputState>(() => ({
    identity: '',
    value: emptyForwardThroughput(),
  }))
  const identity = `${forward.id}\u0000${forward.started_at}`
  const running = enabled && forward.status === 'running'

  if (samplerRef.current === null) {
    samplerRef.current = new ForwardThroughputSampler()
  }

  const clearScheduledPublish = useCallback(() => {
    const scheduled = publishTimerRef.current
    if (scheduled) {
      window.clearTimeout(scheduled.handle)
      publishTimerRef.current = null
    }
  }, [])

  const schedulePublish = useCallback((requestedAt: number) => {
    const generation = generationRef.current
    const existing = publishTimerRef.current
    if (
      existing
      && existing.generation === generation
      && existing.deadline <= requestedAt
    ) {
      return
    }
    if (existing) {
      window.clearTimeout(existing.handle)
      publishTimerRef.current = null
    }

    const arm = (deadline: number) => {
      const delay = Math.max(0, deadline - performance.now()) + 1
      const handle = window.setTimeout(() => {
        const scheduled = publishTimerRef.current
        if (
          !scheduled
          || scheduled.handle !== handle
          || scheduled.generation !== generation
          || generationRef.current !== generation
        ) {
          return
        }
        publishTimerRef.current = null

        const sampler = samplerRef.current
        if (!sampler) {
          return
        }
        const now = performance.now()
        const previousValue = latestValueRef.current
        const value = sampler.expire(now)
        latestValueRef.current = value
        const reachedPublishCadence = now >= nextPublishAtRef.current
        const idleStateChanged = !throughputEqual(previousValue, value)
        if (reachedPublishCadence) {
          nextPublishAtRef.current = now + FORWARD_THROUGHPUT_PUBLISH_MS
        }
        const currentIdentity = identityRef.current
        if (reachedPublishCadence || idleStateChanged) {
          publishedValueRef.current = value
          setState((current) => {
            if (current.identity === currentIdentity && throughputEqual(current.value, value)) {
              return current
            }
            return { identity: currentIdentity, value }
          })
        }

        const nextWakeAt = resolveForwardThroughputNextWakeAt(
          now,
          nextPublishAtRef.current,
          !throughputEqual(publishedValueRef.current, value),
          sampler.nextExpiryAt(),
        )
        if (nextWakeAt !== null) {
          arm(nextWakeAt)
        }
      }, delay)
      publishTimerRef.current = { deadline, generation, handle }
    }

    arm(requestedAt)
  }, [])

  useEffect(() => {
    generationRef.current += 1
    clearScheduledPublish()
    samplerRef.current = new ForwardThroughputSampler()
    latestValueRef.current = emptyForwardThroughput()
    publishedValueRef.current = emptyForwardThroughput()
    identityRef.current = identity
    nextPublishAtRef.current = performance.now() + FORWARD_THROUGHPUT_PUBLISH_MS
    setState((current) => {
      const value = emptyForwardThroughput()
      if (current.identity === identity && throughputEqual(current.value, value)) {
        return current
      }
      return { identity, value }
    })

    return () => {
      generationRef.current += 1
      clearScheduledPublish()
    }
  }, [clearScheduledPublish, identity, running])

  useEffect(() => {
    if (!enabled) {
      return
    }
    const sampler = samplerRef.current
    if (!sampler) {
      return
    }
    const at = performance.now()
    const previous = latestValueRef.current
    const value = sampler.observe({
      forwardId: forward.id,
      startedAt: forward.started_at,
      running,
      bytesIn: forward.bytes_in,
      bytesOut: forward.bytes_out,
      at,
    })
    latestValueRef.current = value

    if (
      running
      && (
        !throughputEqual(previous, value)
        || sampler.nextExpiryAt() !== null
      )
    ) {
      const publishAt = resolveForwardThroughputPublishAt(
        at,
        nextPublishAtRef.current,
        publishTimerRef.current !== null,
      )
      if (publishTimerRef.current === null && publishAt > nextPublishAtRef.current) {
        nextPublishAtRef.current = publishAt
      }
      schedulePublish(publishAt)
    }
  }, [
    forward.bytes_in,
    forward.bytes_out,
    forward.id,
    forward.started_at,
    enabled,
    running,
    schedulePublish,
  ])

  if (state.identity !== identity || !running) {
    return emptyForwardThroughput()
  }
  return state.value
}

function throughputEqual(left: ForwardThroughput, right: ForwardThroughput) {
  return left.bytesInPerSecond === right.bytesInPerSecond
    && left.bytesOutPerSecond === right.bytesOutPerSecond
    && left.receiving === right.receiving
    && left.sending === right.sending
}
