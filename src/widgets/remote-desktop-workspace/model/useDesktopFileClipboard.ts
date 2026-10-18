import { useEffect, useMemo, useRef, useState } from 'react'
import type { DesktopFileClipboard, RemoteDesktopSession } from '#entities/remote-desktop'
import type { OverwritePolicy } from '#entities/file'
import { clearDesktopClipboardSelection, rememberDesktopClipboardSelection, useSystemFileClipboard, type DesktopFilesGateway, type RemoteDesktopViewerState } from '#features/remote-desktop'
import type { useDesktopFiles } from './useDesktopFiles'

export function useDesktopFileClipboard({ api, session, viewer, operations, overwrite }: {
  api: DesktopFilesGateway; session: RemoteDesktopSession; viewer?: RemoteDesktopViewerState
  operations: ReturnType<typeof useDesktopFiles>; overwrite: OverwritePolicy
}) {
  const [state, setState] = useState<DesktopFileClipboard>()
  const [publication, setPublication] = useState<Pick<DesktopFileClipboard, 'published' | 'serving' | 'provided_bytes' | 'content_generation'>>()
  const [selected, setSelected] = useState<number[]>([])
  const system = useSystemFileClipboard(session.id)
  const lifetime = useRef(new AbortController())
  const publicationRevision = useRef(0)
  const lease = viewer?.controlLease
  const leaseId = lease?.id
  const leaseGeneration = lease?.generation
  const permitted = !!(viewer?.controlOwned && !viewer.viewOnly && lease && viewer.connection === 'connected')
  useEffect(() => { const abort = new AbortController(); lifetime.current = abort; return () => abort.abort() }, [session.id, session.connection_generation, permitted, lease?.id, lease?.generation])
  const current = !!state && state.content_generation === publication?.content_generation
  const items = useMemo(() => current && state ? state.files.map(file => ({ path: String(file.index), location: file.name, name: file.name, kind: file.directory ? 'directory' : 'file', size: file.size })) : [], [current, state])
  const query = { generation: session.connection_generation, subscription_id: lease?.id ?? '', control_generation: lease?.generation ?? 0, content_generation: state?.content_generation ?? 0 }
  const outgoing = system.outgoing
  const sending = operations.tasks.find(task => task.id === outgoing?.taskId && task.desktop_session_id === session.id)
  const preparing = system.busy || sending?.status === 'running' || sending?.status === 'queued'
  const selection = permitted && outgoing?.context.sessionId === session.id && outgoing.context.generation === session.connection_generation
    && outgoing.context.subscriptionId === leaseId && outgoing.context.controlGeneration === leaseGeneration
    && sending?.status !== 'failed' && sending?.status !== 'cancelled' && (preparing || publication?.published) && outgoing.items.length ? outgoing : undefined
  const totalBytes = sending && sending.total_bytes > 0 ? sending.total_bytes : undefined
  useEffect(() => {
    if (outgoing && (sending?.status === 'failed' || sending?.status === 'cancelled')) clearDesktopClipboardSelection(outgoing)
  }, [outgoing, sending?.status])

  useEffect(() => {
    if (!permitted || leaseId === undefined || leaseGeneration === undefined) return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const revision = publicationRevision.current
      try {
        const value = await api.clipboard(session.id, { generation: session.connection_generation, subscription_id: leaseId, control_generation: leaseGeneration, content_generation: 0 }, abort.signal)
        if (!abort.signal.aborted && revision === publicationRevision.current) setPublication(value)
      } catch {
        // 查询失败即停用旧清单，防止对已换代的剪贴板继续发起保存。
        if (!abort.signal.aborted && revision === publicationRevision.current) setPublication(undefined)
      }
      if (!abort.signal.aborted) timer = setTimeout(() => void poll(), 1000)
    }
    void poll()
    return () => { abort.abort(); clearTimeout(timer) }
  }, [api, session.id, session.connection_generation, permitted, leaseId, leaseGeneration])

  const read = () => void operations.run(async () => {
    if (!permitted) return
    const signal = lifetime.current.signal
    const current = await api.clipboard(session.id, { ...query, content_generation: 0 }, signal)
    if (signal.aborted) return
    if (!current.available) throw new Error(current.reason)
    const request = { ...query, content_generation: current.content_generation, operation_id: crypto.randomUUID() }
    let operation = await api.requestClipboard(session.id, request, 'list')
    const deadline = Date.now() + 10_000
    while (operation.state === 'running' && !signal.aborted && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 150))
      if (signal.aborted) return
      operation = (await api.clipboard(session.id, request, signal)).operation ?? operation
    }
    if (signal.aborted) return
    if (operation.state !== 'completed') throw new Error(operation.error_code ?? 'desktop_files_not_ready')
    const files: DesktopFileClipboard['files'] = []
    let page: DesktopFileClipboard
    do {
      page = await api.clipboard(session.id, { ...request, offset: files.length, limit: 128 }, signal)
      files.push(...(page.files ?? []))
      if (files.length > 4096 || page.total_files > files.length && !page.files?.length) throw new Error('desktop_files_invalid_list')
    } while (files.length < page.total_files)
    if (!signal.aborted) {
      setState({ ...page, files })
      setSelected(files.filter(file => !file.name.includes('/')).map(file => file.index))
    }
  })

  const transfer = (action: 'publish' | 'receive', folder = false) => void operations.run(async () => {
    if (!permitted || action === 'receive' && !current) return
    const signal = lifetime.current.signal
    await operations.withGrant(action === 'receive' || folder ? 'directories' : 'files', action === 'publish', async (grant, items) => {
      if (signal.aborted) return
      const task = await api.transferClipboard(session.id, { ...query, operation_id: crypto.randomUUID() }, action, grant, selected, overwrite)
      if (!signal.aborted && action === 'publish' && task.status !== 'failed' && task.status !== 'cancelled') rememberDesktopClipboardSelection({ sessionId: session.id, generation: session.connection_generation, subscriptionId: query.subscription_id, controlGeneration: query.control_generation }, task.id, items)
    })
  })
  const revoke = () => void operations.run(async () => {
    if (!permitted || !publication?.published) return
    const signal = lifetime.current.signal
    const request = { ...query, operation_id: crypto.randomUUID() }
    let operation = await api.requestClipboard(session.id, request, 'revoke')
    const deadline = Date.now() + 10_000
    // 撤销也是异步操作，收到请求不等于远程已停止提供文件。
    while (operation.state === 'running' && !signal.aborted && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 150))
      if (signal.aborted) return
      operation = (await api.clipboard(session.id, request, signal)).operation ?? operation
    }
    if (signal.aborted) return
    if (operation.state !== 'completed') throw new Error(operation.error_code ?? 'desktop_files_not_ready')
    // 确认撤销后同步状态，并拒绝此前发起的轮询将旧发布状态写回。
    publicationRevision.current++
    setPublication(value => value && { ...value, published: false, serving: false })
    if (outgoing) clearDesktopClipboardSelection(outgoing)
  })

  return { permitted, publication, state, current, items, selected, setSelected, system, selection, preparing, totalBytes, read, transfer, revoke }
}
