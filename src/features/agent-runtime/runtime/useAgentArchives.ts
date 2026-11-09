import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentMessage, AgentSession } from '#entities/agent'
import type { AgentWorkspaceGateway } from '../api/agentRuntimeGateway.ts'
import { loadAgentMessages } from './loadAgentMessages.ts'
import { loadAgentSessions } from './loadAgentSessions.ts'
import { AgentContentWindow, mergeTimelineMessages, timelineBoundary } from '../model/agentContentWindow.ts'

type ArchiveGateway = Pick<AgentWorkspaceGateway, 'sessions' | 'messages' | 'timelineSupported'>

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
  const contentWindow = useRef(new AgentContentWindow())
  const [hasOlder, setHasOlder] = useState(false)
  const [hasNewer, setHasNewer] = useState(false)

  const loadHistory = async (direction: 'before' | 'after') => {
    if (!selectedSessionId || !gateway.timelineSupported || !messages.length) return
    const boundary = direction === 'before' ? messages[0]! : messages[messages.length - 1]!
    previewController.current?.abort()
    const controller = new AbortController()
    previewController.current = controller
    setPreviewLoading(true)
    setPreviewError(undefined)
    try {
      const page = await gateway.messages(selectedSessionId, { view: 'timeline', limit: 100, direction,
        cursor: timelineBoundary(selectedSessionId, boundary, direction === 'before' ? 'first' : 'last'), signal: controller.signal })
      if (controller.signal.aborted || previewController.current !== controller) return
      if (page.items.some(message => message.session_id !== selectedSessionId)) throw new Error('AGENT_MESSAGE_OWNER_INVALID')
      setMessages(current => contentWindow.current.boundMessages(mergeTimelineMessages(current, page.items), direction === 'before'))
      setHasOlder(direction === 'after' || Boolean(page.has_older))
      setHasNewer(direction === 'before' || Boolean(page.has_newer))
    } catch (error) {
      if (!controller.signal.aborted) setPreviewError(archiveErrorCode(error))
    } finally {
      if (previewController.current === controller) {
        previewController.current = undefined
        setPreviewLoading(false)
      }
    }
  }

  const selectSession = useCallback((id?: string) => {
    if (id === selectedSessionId) return
    previewController.current?.abort()
    setSelectedSessionId(id)
    setMessages([])
    setPreviewError(undefined)
    setHasOlder(false); setHasNewer(false)
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
    const request = gateway.timelineSupported
      ? gateway.messages(selectedSessionId, { view: 'timeline', limit: 100, signal: controller.signal })
      : loadAgentMessages(gateway, selectedSessionId, 0, controller.signal).then(items => ({ items, has_older: false, has_newer: false }))
    void request.then((page) => {
      if (!controller.signal.aborted) {
        if (page.items.some(message => message.session_id !== selectedSessionId)) throw new Error('AGENT_MESSAGE_OWNER_INVALID')
        const bounded = contentWindow.current.boundMessages(page.items)
        setMessages(bounded)
        setHasOlder(Boolean(page.has_older) || timelinePartCount(bounded) < timelinePartCount(page.items))
        setHasNewer(Boolean(page.has_newer))
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setPreviewError(archiveErrorCode(error))
    }).finally(() => {
      if (!controller.signal.aborted) setPreviewLoading(false)
    })
    return () => {
      controller.abort()
      previewController.current?.abort()
      previewController.current = undefined
    }
  }, [gateway, open, selectedSessionId, previewRevision])

  return {
    query, setQuery, sessions, listLoading, listError,
    selectedSessionId,
    selectedSession: sessions.find(({ id }) => id === selectedSessionId),
    messages, previewLoading, previewError,
    selectSession, reload, reloadPreview, removeSession,
    loadOlder: hasOlder ? () => loadHistory('before') : undefined,
    loadNewer: hasNewer ? () => loadHistory('after') : undefined,
  }
}

function timelinePartCount(messages: AgentMessage[]) {
  return messages.reduce((count, message) => count + Math.max(1, message.parts.length), 0)
}

function archiveErrorCode(error: unknown) {
  if (error && typeof error === 'object') {
    const code = Reflect.get(error, 'code')
    if (typeof code === 'string' && code) return code
  }
  return 'AGENT_WORKSPACE_UNAVAILABLE'
}
