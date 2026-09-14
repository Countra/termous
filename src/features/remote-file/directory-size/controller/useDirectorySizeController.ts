import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  RemoteDirectorySize,
  RemoteDirectorySizeRequest,
} from '#entities/file'
import type { DirectorySizeResultCache } from '../model/DirectorySizeResultCache.ts'
import type { DirectorySizeSource, DirectorySizeState } from '../model/types.ts'

export interface DirectorySizeGateway {
  calculateFileSessionDirectorySize: (
    fileSessionId: string,
    input: RemoteDirectorySizeRequest,
    signal?: AbortSignal,
  ) => Promise<RemoteDirectorySize>
}

interface DirectorySizeControllerOptions {
  api: DirectorySizeGateway
  cache: DirectorySizeResultCache
  source: DirectorySizeSource | null
  enabled: boolean
  onError?: (error: unknown) => void
}

export function useDirectorySizeController({
  api,
  cache,
  source,
  enabled,
  onError,
}: DirectorySizeControllerOptions) {
  const sourceKey = source ? directorySizeSourceKey(source) : ''
  const [state, setState] = useState<DirectorySizeState>(() => (
    peekCachedDirectorySizeState(cache, source, sourceKey)
  ))
  const requestRef = useRef<{ sequence: number; controller: AbortController | null }>({
    sequence: 0,
    controller: null,
  })
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const sourceRef = useRef(source)
  const sourceKeyRef = useRef(sourceKey)
  sourceRef.current = source
  sourceKeyRef.current = sourceKey

  const invalidate = useCallback(() => {
    requestRef.current.sequence += 1
    requestRef.current.controller?.abort()
    requestRef.current.controller = null
  }, [])

  const restoreCachedState = useCallback(() => {
    invalidate()
    setState(cachedDirectorySizeState(
      cache,
      sourceRef.current,
      sourceKeyRef.current,
    ))
  }, [cache, invalidate])

  useEffect(() => {
    restoreCachedState()
    return invalidate
  }, [enabled, invalidate, restoreCachedState, sourceKey])

  const calculate = useCallback(async () => {
    const currentSource = sourceRef.current
    const ownerKey = sourceKeyRef.current
    if (!enabled || !currentSource || !ownerKey) {
      return
    }

    requestRef.current.controller?.abort()
    const controller = new AbortController()
    const sequence = requestRef.current.sequence + 1
    requestRef.current = { sequence, controller }
    setState({ status: 'running', ownerKey })

    try {
      const result = await api.calculateFileSessionDirectorySize(
        currentSource.fileSessionId,
        {
          path: currentSource.path,
          expected_connection_generation: currentSource.connectionGeneration,
        },
        controller.signal,
      )
      if (!isCurrentRequest(requestRef.current, sequence, controller, ownerKey, sourceKeyRef.current)) {
        return
      }
      validateDirectorySizeResult(result, currentSource)
      requestRef.current.controller = null
      cache.set(currentSource, result)
      setState({ status: 'success', ownerKey, result })
    } catch (error) {
      if (!isCurrentRequest(requestRef.current, sequence, controller, ownerKey, sourceKeyRef.current)) {
        return
      }
      requestRef.current.controller = null
      if (controller.signal.aborted || isRequestCancelled(error)) {
        setState(cachedDirectorySizeState(cache, currentSource, ownerKey))
        return
      }
      setState({ status: 'error', ownerKey, error })
      onErrorRef.current?.(error)
    }
  }, [api, cache, enabled])

  const visibleState = state.status !== 'idle' && state.ownerKey === sourceKey
    ? state
    : peekCachedDirectorySizeState(cache, source, sourceKey)

  return {
    state: visibleState,
    calculate,
    cancel: restoreCachedState,
  }
}

function cachedDirectorySizeState(
  cache: DirectorySizeResultCache,
  source: DirectorySizeSource | null,
  ownerKey: string,
): DirectorySizeState {
  if (!source || !ownerKey) {
    return { status: 'idle' }
  }
  const result = cache.get(source)
  return result
    ? { status: 'success', ownerKey, result }
    : { status: 'idle' }
}

function peekCachedDirectorySizeState(
  cache: DirectorySizeResultCache,
  source: DirectorySizeSource | null,
  ownerKey: string,
): DirectorySizeState {
  if (!source || !ownerKey) {
    return { status: 'idle' }
  }
  const result = cache.peek(source)
  return result
    ? { status: 'success', ownerKey, result }
    : { status: 'idle' }
}

export function directorySizeSourceKey(source: DirectorySizeSource) {
  return JSON.stringify([
    source.fileSessionId,
    source.connectionGeneration,
    source.path,
    source.listingReadAt,
  ])
}

function isCurrentRequest(
  current: { sequence: number; controller: AbortController | null },
  sequence: number,
  controller: AbortController,
  ownerKey: string,
  currentSourceKey: string,
) {
  return current.sequence === sequence
    && current.controller === controller
    && ownerKey === currentSourceKey
}

function validateDirectorySizeResult(
  result: RemoteDirectorySize,
  source: DirectorySizeSource,
) {
  if (
    result.file_session_id !== source.fileSessionId
    || result.path !== source.path
    || result.connection_generation !== source.connectionGeneration
    || !Number.isSafeInteger(result.total_bytes)
    || result.total_bytes < 0
    || !Number.isFinite(result.duration_ms)
    || result.duration_ms < 0
    || typeof result.estimated !== 'boolean'
    || !Number.isFinite(Date.parse(result.calculated_at))
  ) {
    throw new Error('目录大小响应与当前文件视图不一致')
  }
}

function isRequestCancelled(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
    || Boolean(error && typeof error === 'object' && Reflect.get(error, 'code') === 'REQUEST_ABORTED')
}
