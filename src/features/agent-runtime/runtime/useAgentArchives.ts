import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentMessage, AgentSession } from '#entities/agent'
import type { AgentWorkspaceGateway } from '../api/agentRuntimeGateway.ts'
import { loadAgentMessages } from './loadAgentMessages.ts'
import { loadAgentSessions } from './loadAgentSessions.ts'

type ArchiveGateway = Pick<AgentWorkspaceGateway, 'sessions' | 'messages'>

export function useAgentArchives(gateway: ArchiveGateway, open: boolean, sessionSnapshot?: readonly AgentSession[]) {
  const [query, setQueryValue] = useState('')
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string>()
  const [selectedSessionId, setSelectedSessionId] = useState<string>()
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string>()
  const [listRevision, setListRevision] = useState(0)
  const [previewRevision, setPreviewRevision] = useState(0)
  const listController = useRef<AbortController | undefined>(undefined)
  const previewController = useRef<AbortController | undefined>(undefined)

  const selectSession = useCallback((id?: string) => {
    if (id === selectedSessionId) return
    previewController.current?.abort()
    setSelectedSessionId(id)
    setMessages([])
    setPreviewError(undefined)
    setPreviewLoading(Boolean(id))
  }, [selectedSessionId])

  const setQuery = useCallback((value: string) => {
    if (value === query) return
    listController.current?.abort()
    setQueryValue(value)
    setSessions([])
    setListError(undefined)
    setListLoading(true)
    selectSession()
  }, [query, selectSession])

  const reload = useCallback(() => {
    listController.current?.abort()
    setListRevision((revision) => revision + 1)
  }, [])

  const reloadPreview = useCallback(() => {
    previewController.current?.abort()
    setPreviewRevision((revision) => revision + 1)
  }, [])

  const removeSession = useCallback((id: string) => {
    // 恢复或删除的回执不能被尚未结束的旧列表查询重新插回。
    listController.current?.abort()
    setSessions((current) => current.filter((session) => session.id !== id))
    setSelectedSessionId((current) => current === id ? undefined : current)
    setListRevision((revision) => revision + 1)
  }, [])

  useEffect(() => {
    if (!open) {
      setQueryValue('')
      setSessions([])
      setListError(undefined)
      setListLoading(false)
      setSelectedSessionId(undefined)
      setMessages([])
      setPreviewError(undefined)
      setPreviewLoading(false)
      return
    }
    const controller = new AbortController()
    listController.current = controller
    setListLoading(true)
    setListError(undefined)
    void loadAgentSessions(gateway, { archived: true, query: query.trim(), signal: controller.signal }).then((next) => {
      if (controller.signal.aborted) return
      setSessions(next)
      setSelectedSessionId((current) => next.some(({ id }) => id === current) ? current : undefined)
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setListError(archiveErrorCode(error))
    }).finally(() => {
      if (!controller.signal.aborted) setListLoading(false)
    })
    return () => {
      controller.abort()
      if (listController.current === controller) listController.current = undefined
    }
  // 只跟随会话实体变化和重连快照重新查询，流式消息事件不触发归档重载。
  }, [gateway, open, query, listRevision, sessionSnapshot])

  useEffect(() => {
    if (!open || !selectedSessionId) {
      setMessages([])
      setPreviewLoading(false)
      setPreviewError(undefined)
      return
    }
    const controller = new AbortController()
    previewController.current = controller
    setMessages([])
    setPreviewLoading(true)
    setPreviewError(undefined)
    void loadAgentMessages(gateway, selectedSessionId, 0, controller.signal).then((next) => {
      if (!controller.signal.aborted) setMessages(next)
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setPreviewError(archiveErrorCode(error))
    }).finally(() => {
      if (!controller.signal.aborted) setPreviewLoading(false)
    })
    return () => {
      controller.abort()
      if (previewController.current === controller) previewController.current = undefined
    }
  }, [gateway, open, selectedSessionId, previewRevision])

  return {
    query, setQuery, sessions, listLoading, listError,
    selectedSessionId,
    selectedSession: sessions.find(({ id }) => id === selectedSessionId),
    messages, previewLoading, previewError,
    selectSession, reload, reloadPreview, removeSession,
  }
}

function archiveErrorCode(error: unknown) {
  if (error && typeof error === 'object') {
    const code = Reflect.get(error, 'code')
    if (typeof code === 'string' && code) return code
  }
  return 'AGENT_WORKSPACE_UNAVAILABLE'
}
