import { useCallback, useContext, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import type { FilePickerMode } from '#common/contracts'
import type { LocalGrantItem, TransferTask } from '#entities/file'
import type { DesktopExchange, DesktopFilesState } from '#entities/remote-desktop'
import type { DesktopFilesGateway } from '#features/remote-desktop'
import { TransferRuntimeContext } from '#features/transfers'
import { TermousApiError } from '#shared/api'
import { getTermousBridge } from '#shared/bridge'
import { desktopSessionTransfers } from './desktopTransferSummary'

export function desktopFileError(error: unknown) {
  if (error instanceof TermousApiError) return error.code
  const clipboardErrors: Record<string, string> = {
    rdp_file_clipboard_empty: 'desktop_file_clipboard_empty',
    rdp_clipboard_stale: 'desktop_files_stale',
    rdp_clipboard_unavailable: 'desktop_files_unsupported',
    rdp_file_clipboard_unavailable: 'desktop_files_unsupported',
    rdp_clipboard_busy: 'desktop_busy',
    rdp_clipboard_desynchronized: 'desktop_file_clipboard_desynchronized',
    rdp_file_clipboard_failed: 'desktop_file_clipboard_failed',
    desktop_files_not_ready: 'desktop_file_clipboard_pending',
    desktop_files_invalid_list: 'desktop_file_clipboard_failed',
  }
  return error instanceof Error ? clipboardErrors[error.message] ?? 'desktop_files_storage_failed' : 'desktop_files_storage_failed'
}

export function useDesktopFiles(api: DesktopFilesGateway, sessionId: string | undefined, generation: number, enabled = true) {
  const [state, setState] = useState<DesktopFilesState>()
  const [retained, setRetained] = useState<DesktopExchange[]>([])
  const [fallbackTasks, setFallbackTasks] = useState<TransferTask[]>([])
  const transfers = useContext(TransferRuntimeContext)
  const refreshTransfers = transfers?.refresh
  const liveConnected = transfers?.connected ?? false
  const taskSource = transfers?.transfers ?? fallbackTasks
  const tasks = useMemo(() => desktopSessionTransfers(taskSource, sessionId), [taskSource, sessionId])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false)
  const alive = useRef<AbortController | null>(null)
  const refreshSequence = useRef(0)

  const refresh = useCallback(async (signal?: AbortSignal, refreshTasks = true) => {
    signal ??= alive.current?.signal
    if (!signal || signal.aborted) return
    const request = ++refreshSequence.current
    const [nextState, nextRetained, nextTasks] = await Promise.allSettled([
      sessionId ? api.describe(sessionId, generation, signal) : Promise.resolve(undefined), api.retained(signal),
      refreshTasks ? (refreshTransfers ? refreshTransfers() : api.tasks(signal)) : Promise.resolve(undefined),
    ])
    // 轮询与手动刷新可以重叠，只有当前生命周期内最新发起的查询可以回写。
    if (signal.aborted || request !== refreshSequence.current) return
    if (nextState.status === 'fulfilled') setState(nextState.value)
    if (nextRetained.status === 'fulfilled') setRetained(nextRetained.value)
    if (nextTasks.status === 'fulfilled' && nextTasks.value) setFallbackTasks(nextTasks.value)
    const failed = [nextState, nextRetained, nextTasks].find(result => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
  }, [api, generation, sessionId, refreshTransfers])

  const pollRefresh = useEffectEvent((signal: AbortSignal) => refresh(signal, !liveConnected))
  useEffect(() => {
    if (!enabled) return
    const abort = new AbortController()
    alive.current = abort
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      // 正式应用复用全局任务事件流，断流和独立预览才补查任务快照。
      try { await pollRefresh(abort.signal) } catch (error) { if (!abort.signal.aborted) setError(desktopFileError(error)) }
      if (!abort.signal.aborted) timer = setTimeout(() => void poll(), 2000)
    }
    void poll()
    return () => { abort.abort(); clearTimeout(timer) }
  }, [enabled, refresh])

  const run = useCallback(async (action: () => Promise<unknown>) => {
    const lifetime = alive.current
    if (busyRef.current || !lifetime || lifetime.signal.aborted) return false
    busyRef.current = true
    setBusy(true)
    setError('')
    try { await action(); if (!lifetime.signal.aborted) await refresh(lifetime.signal); return true } catch (error) {
      if (!lifetime.signal.aborted) setError(desktopFileError(error))
      return false
    } finally {
      // 关闭侧栏只暂停查询，已发起操作结束后仍须释放保留页面的忙碌状态。
      busyRef.current = false
      setBusy(false)
    }
  }, [refresh])

  const withGrant = useCallback(async (mode: FilePickerMode, multiple: boolean, action: (grantId: string, items: LocalGrantItem[]) => Promise<unknown>) => {
    const picker = getTermousBridge()?.files?.pickPaths
    if (!picker) throw new TermousApiError('请在桌面应用中选择文件', 'desktop_files_picker_unavailable', 0)
    const signal = alive.current?.signal
    const paths = await picker({ mode, multiple })
    if (!paths.length || signal?.aborted) return
    const grant = await api.grant(paths)
    try { if (!signal?.aborted) await action(grant.id, grant.items) } finally { await api.releaseGrant(grant.id) }
  }, [api])

  return { state, retained, tasks, liveConnected, busy, error, run, refresh, withGrant }
}
