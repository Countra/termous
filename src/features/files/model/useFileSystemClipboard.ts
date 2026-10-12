import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { FileSystemClipboardState } from '#common/contracts'
import { getTermousBridge } from '#shared/bridge'

type ClipboardViewState = FileSystemClipboardState & { cancelling?: boolean }
const initial: ClipboardViewState = { supported: false, phase: 'idle', names: [], count: 0, total_bytes: 0 }
let state = initial
let pending = false
let revision = 0
let actionError: string | undefined
let failedCopyOperation: string | undefined
let stopping = false
let copying = false
let timer: ReturnType<typeof setInterval> | undefined
const listeners = new Set<() => void>()
const emit = (value: ClipboardViewState) => { state = value; listeners.forEach(listener => listener()) }
const bridge = () => getTermousBridge()?.fileSystemClipboard

async function refresh() {
  if (pending || copying || stopping || !bridge()) return
  pending = true
  const version = revision
  try {
    const result = await bridge()!.status()
    if (version === revision) {
      if (result.ok) {
        if (result.value.phase === 'closed' || failedCopyOperation && result.value.operation_id === failedCopyOperation) {
          actionError = undefined
          failedCopyOperation = undefined
        }
        emit({ ...result.value, ...(actionError ? { phase: state.phase === 'cleanup_pending' ? 'cleanup_pending' : 'failed', error_code: actionError } : {}) })
      }
      else if (state.phase !== 'stopped' && state.phase !== 'closed' && (state.operation_id || state.publication_id)) emit({ ...state, phase: 'failed', error_code: result.code })
    }
  } catch {
    if (version === revision && state.phase !== 'stopped' && state.phase !== 'closed' && (state.operation_id || state.publication_id)) {
      emit({ ...state, phase: 'failed', error_code: 'FILE_CLIPBOARD_FAILED' })
    }
  } finally { pending = false }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) { void refresh(); timer = setInterval(() => { void refresh() }, 1000) }
  return () => { listeners.delete(listener); if (!listeners.size) { clearInterval(timer); timer = undefined } }
}

export function useFileSystemClipboard(onPublished?: () => void) {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => initial)
  const callback = useRef(onPublished)
  const seen = useRef('')
  useEffect(() => { callback.current = onPublished }, [onPublished])
  useEffect(() => {
    if (snapshot.published && snapshot.publication_id && snapshot.publication_id !== seen.current) {
      seen.current = snapshot.publication_id
      callback.current?.()
    }
  }, [snapshot.publication_id, snapshot.published])
  const copy = useCallback(async (session: { id: string; connection_generation?: number }, paths: string[]) => {
    const client = bridge()
    if (copying || stopping || state.phase === 'preparing' || paths.length === 0) return
    actionError = undefined
    failedCopyOperation = undefined
    if (!client) { actionError = 'FILE_CLIPBOARD_UNSUPPORTED'; emit({ ...state, phase: 'failed', error_code: actionError }); return }
    copying = true
    const version = ++revision
    const operationId = crypto.randomUUID()
    emit({ ...initial, supported: true, phase: 'preparing', operation_id: operationId })
    try {
      const result = await client.copy({ file_session_id: session.id, connection_generation: session.connection_generation ?? 0, operation_id: operationId, paths })
      if (version !== revision) return
      if (result.ok) emit(result.value)
      else { failedCopyOperation = operationId; actionError = result.code; emit({ ...state, phase: 'failed', error_code: result.code }) }
    } catch { if (version === revision) { failedCopyOperation = operationId; actionError = 'FILE_CLIPBOARD_FAILED'; emit({ ...state, phase: 'failed', error_code: actionError }) } } finally { copying = false }
  }, [])
  const revoke = useCallback(async (publicationId = state.publication_id) => {
    const client = bridge()
    if (!publicationId || publicationId !== state.publication_id || state.phase === 'stopped' || stopping || !client) return
    stopping = true
    const version = ++revision
    actionError = undefined
    failedCopyOperation = undefined
    emit({ ...state, cancelling: true, error_code: undefined })
    try {
      const result = await client.revoke(publicationId).catch(() => ({ ok: false as const, code: 'FILE_CLIPBOARD_CANCEL_FAILED' }))
      if (version !== revision) return
      if (!result.ok) {
        actionError = result.code
        emit({ ...state, cancelling: false, phase: 'cleanup_pending', error_code: result.code })
      } else {
        // 撤销已获后端确认，立即投影终态；旧轮询不能复活取消前的提示。
        emit({ ...state, cancelling: false, phase: 'stopped', error_code: undefined })
      }
    } finally { stopping = false }
  }, [])
  return { state: snapshot, copy, revoke, cancelling: !!snapshot.cancelling, enabled: !!bridge(), available: !!bridge() && snapshot.supported }
}
