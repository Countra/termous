import { useEffect, useMemo, useRef, useState } from 'react'
import type { DesktopFileClipboard, RemoteDesktopSession } from '#entities/remote-desktop'
import type { OverwritePolicy } from '#entities/file'
import type { DesktopFilesGateway, RemoteDesktopViewerState } from '#features/remote-desktop'
import type { useDesktopFiles } from './useDesktopFiles'

export function useDesktopFileClipboard({ api, session, viewer, operations, overwrite }: {
  api: DesktopFilesGateway; session: RemoteDesktopSession; viewer?: RemoteDesktopViewerState
  operations: ReturnType<typeof useDesktopFiles>; overwrite: OverwritePolicy
}) {
  const [state, setState] = useState<DesktopFileClipboard>()
  const [publication, setPublication] = useState<Pick<DesktopFileClipboard, 'published' | 'serving' | 'provided_bytes' | 'content_generation'>>()
  const [selected, setSelected] = useState<number[]>([])
  const lifetime = useRef(new AbortController())
  const lease = viewer?.controlLease
  const leaseId = lease?.id
  const leaseGeneration = lease?.generation
  const permitted = !!(viewer?.controlOwned && !viewer.viewOnly && lease && viewer.connection === 'connected')
  useEffect(() => { const abort = new AbortController(); lifetime.current = abort; return () => abort.abort() }, [session.id, session.connection_generation, permitted, lease?.id, lease?.generation])
  const current = !!state && state.content_generation === publication?.content_generation
  const items = useMemo(() => current && state ? state.files.map(file => ({ path: String(file.index), location: file.name, name: file.name, kind: file.directory ? 'directory' : 'file', size: file.size })) : [], [current, state])
  const query = { generation: session.connection_generation, subscription_id: lease?.id ?? '', control_generation: lease?.generation ?? 0, content_generation: state?.content_generation ?? 0 }

  useEffect(() => {
    if (!permitted || leaseId === undefined || leaseGeneration === undefined) return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const value = await api.clipboard(session.id, { generation: session.connection_generation, subscription_id: leaseId, control_generation: leaseGeneration, content_generation: 0 }, abort.signal)
        if (!abort.signal.aborted) setPublication(value)
      } catch {
        // 查询失败即停用旧清单，防止对已换代的剪贴板继续发起保存。
        if (!abort.signal.aborted) setPublication(undefined)
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
    await operations.withGrant(action === 'receive' || folder ? 'directories' : 'files', action === 'publish', async grant => {
      if (!signal.aborted) await api.transferClipboard(session.id, { ...query, operation_id: crypto.randomUUID() }, action, grant, selected, overwrite)
    })
  })
  const revoke = () => void operations.run(async () => {
    if (permitted && publication?.published) await api.requestClipboard(session.id, { ...query, operation_id: crypto.randomUUID() }, 'revoke')
  })

  return { permitted, publication, state, current, items, selected, setSelected, read, transfer, revoke }
}
