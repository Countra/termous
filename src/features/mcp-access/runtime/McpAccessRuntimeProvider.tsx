import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  McpApproval,
  McpApprovalDecision,
  McpApprovalEvent,
  McpApprovalSnapshot,
  McpClient,
  McpClientInput,
  McpClientPatch,
  McpStatus,
} from '#entities/mcp-access'
import { retireWebSocket } from '#shared/websocket'
import type { McpAccessGateway } from '../api/mcpAccessGateway'
import { decodeMcpApprovalEvent } from '../model/mcpAccessProtocol'
import {
  emptyApprovalSnapshot,
  mergeApprovalDecision,
  mergeApprovalSnapshot,
} from './approvalSnapshots'
import { McpAccessRuntimeContext, type McpAccessRuntimePhase } from './mcpAccessContext'

interface McpAccessRuntimeProviderProps {
  api: McpAccessGateway
  enabled: boolean
  children: ReactNode
}

const reconnectInitialDelay = 500
const reconnectMaximumDelay = 5_000

export function McpAccessRuntimeProvider({ api, enabled, children }: McpAccessRuntimeProviderProps) {
  const [phase, setPhase] = useState<McpAccessRuntimePhase>('idle')
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [clients, setClients] = useState<McpClient[]>([])
  const [approvals, setApprovals] = useState<McpApproval[]>([])
  const [mutationKey, setMutationKey] = useState('')
  const [errorCode, setErrorCode] = useState('')
  const approvalSnapshotRef = useRef<McpApprovalSnapshot>(emptyApprovalSnapshot())
  const requestGenerationRef = useRef(0)
  const reconcileAbortRef = useRef<AbortController | null>(null)
  const mutationKeyRef = useRef('')
  const runtimeActiveRef = useRef(false)

  const applyApprovalSnapshot = useCallback((snapshot: McpApprovalSnapshot) => {
    const current = approvalSnapshotRef.current
    const next = mergeApprovalSnapshot(current, snapshot)
    if (next === current) return
    approvalSnapshotRef.current = next
    setApprovals(next.items)
  }, [])

  const reconcile = useCallback(async (mode: 'loading' | 'reconciling' = 'reconciling') => {
    if (mutationKeyRef.current) return
    const generation = ++requestGenerationRef.current
    reconcileAbortRef.current?.abort()
    const controller = new AbortController()
    reconcileAbortRef.current = controller
    setPhase(mode)
    try {
      const [nextStatus, nextClients, nextApprovals] = await Promise.all([
        api.status(controller.signal),
        api.clients(controller.signal),
        api.approvals(controller.signal),
      ])
      if (generation !== requestGenerationRef.current) return
      setStatus(nextStatus)
      setClients(nextClients)
      applyApprovalSnapshot(nextApprovals)
      setErrorCode('')
      setPhase('ready')
    } catch (error) {
      if (generation !== requestGenerationRef.current) return
      setErrorCode(runtimeErrorCode(error))
      setPhase('degraded')
      throw error
    } finally {
      if (reconcileAbortRef.current === controller) reconcileAbortRef.current = null
    }
  }, [api, applyApprovalSnapshot])
  const reconcileRef = useRef(reconcile)
  reconcileRef.current = reconcile

  useEffect(() => {
    if (!enabled) {
      runtimeActiveRef.current = false
      requestGenerationRef.current += 1
      reconcileAbortRef.current?.abort()
      reconcileAbortRef.current = null
      approvalSnapshotRef.current = emptyApprovalSnapshot()
      setPhase('idle')
      setStatus(null)
      setClients([])
      setApprovals([])
      setErrorCode('')
      return undefined
    }
    runtimeActiveRef.current = true
    void reconcile('loading').catch(() => undefined)
    return () => {
      runtimeActiveRef.current = false
      requestGenerationRef.current += 1
      reconcileAbortRef.current?.abort()
      reconcileAbortRef.current = null
    }
  }, [enabled, reconcile])

  useEffect(() => {
    if (!enabled) return undefined
    let disposed = false
    let socket: WebSocket | null = null
    let reconnectTimer = 0
    let reconnectDelay = reconnectInitialDelay

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer) return
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = 0
        connect()
      }, reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, reconnectMaximumDelay)
    }
    const reconcileSafely = () => void reconcile().catch(() => undefined)
    const applyEvent = (event: McpApprovalEvent) => applyApprovalSnapshot(event.snapshot)
    function connect() {
      if (disposed || socket) return
      try {
        socket = new WebSocket(api.approvalEventsUrl())
      } catch {
        scheduleReconnect()
        return
      }
      const currentSocket = socket
      currentSocket.addEventListener('open', () => {
        reconnectDelay = reconnectInitialDelay
        reconcileSafely()
      })
      currentSocket.addEventListener('message', (message: MessageEvent<string>) => {
        if (disposed || socket !== currentSocket) return
        try {
          const event = decodeMcpApprovalEvent(JSON.parse(String(message.data)))
          applyEvent(event)
        } catch {
          reconcileSafely()
        }
      })
      currentSocket.addEventListener('error', () => currentSocket.close())
      currentSocket.addEventListener('close', () => {
        if (socket === currentSocket) socket = null
        scheduleReconnect()
      })
    }
    connect()
    return () => {
      disposed = true
      window.clearTimeout(reconnectTimer)
      if (socket) retireWebSocket(socket)
    }
  }, [api, applyApprovalSnapshot, enabled, reconcile])

  const runMutation = useCallback(async <Result,>(
    key: string,
    operation: (isCurrent: () => boolean) => Promise<Result>,
  ) => {
    if (mutationKeyRef.current) throw new Error('MCP 设置操作正在进行')
    const generation = ++requestGenerationRef.current
    reconcileAbortRef.current?.abort()
    reconcileAbortRef.current = null
    mutationKeyRef.current = key
    setMutationKey(key)
    try {
      return await operation(() => requestGenerationRef.current === generation)
    } finally {
      if (mutationKeyRef.current === key) {
        mutationKeyRef.current = ''
        setMutationKey('')
        // mutation 响应只更新直接资源；随后统一拉取权威快照，补齐并发变化。
        if (runtimeActiveRef.current) {
          void reconcileRef.current().catch(() => undefined)
        }
      }
    }
  }, [])

  const setEnabled = useCallback((nextEnabled: boolean) => runMutation('server', async (isCurrent) => {
    if (!status) throw new Error('MCP 服务状态尚未就绪')
    const nextStatus = await api.updateSettings({
      enabled: nextEnabled,
      expected_revision: status.revision,
    })
    if (isCurrent()) setStatus(nextStatus)
  }), [api, runMutation, status])

  const createClient = useCallback((input: McpClientInput) => runMutation('client:create', async (isCurrent) => {
    const issued = await api.createClient(input)
    if (isCurrent()) {
      setClients((current) => [issued.client, ...current.filter((item) => item.id !== issued.client.id)])
    }
    return issued
  }), [api, runMutation])

  const patchClient = useCallback((clientId: string, patch: McpClientPatch) => (
    runMutation(`client:${clientId}`, async (isCurrent) => {
      const currentClient = clients.find((item) => item.id === clientId)
      if (!currentClient) throw new Error('MCP 客户端不存在')
      const client = await api.patchClient(clientId, {
        name: patch.name ?? currentClient.name,
        enabled: patch.enabled ?? currentClient.enabled,
        approval_bypass: patch.approval_bypass ?? currentClient.approval_bypass,
        scopes: patch.scopes ?? currentClient.scopes,
        expected_revision: currentClient.revision,
      })
      if (isCurrent()) {
        setClients((current) => current.map((item) => item.id === client.id ? client : item))
      }
    })
  ), [api, clients, runMutation])

  const deleteClient = useCallback((clientId: string) => runMutation(`client:${clientId}`, async (isCurrent) => {
    const currentClient = clients.find((item) => item.id === clientId)
    if (!currentClient) throw new Error('MCP 客户端不存在')
    await api.deleteClient(clientId, currentClient.revision)
    if (isCurrent()) {
      setClients((current) => current.filter((item) => item.id !== clientId))
    }
  }), [api, clients, runMutation])

  const issueToken = useCallback((clientId: string) => runMutation(`client:${clientId}:token`, async (isCurrent) => {
    const currentClient = clients.find((item) => item.id === clientId)
    if (!currentClient) throw new Error('MCP 客户端不存在')
    const issued = await api.issueClientToken(clientId, currentClient.revision)
    if (isCurrent()) {
      setClients((current) => current.map((item) => item.id === issued.client.id ? issued.client : item))
    }
    return issued
  }), [api, clients, runMutation])

  const decideApproval = useCallback((approvalId: string, decision: McpApprovalDecision) => (
    runMutation(`approval:${approvalId}`, async (isCurrent) => {
      const approval = approvalSnapshotRef.current.items.find((item) => item.id === approvalId)
      if (!approval) throw new Error('MCP 审批请求不存在')
      const result = await api.decideApproval(approvalId, decision, approval.revision)
      if (!isCurrent()) return
      const current = approvalSnapshotRef.current
      const next = mergeApprovalDecision(current, result.approval)
      approvalSnapshotRef.current = next
      setApprovals(next.items)
    })
  ), [api, runMutation])

  const value = useMemo(() => ({
    phase,
    status,
    clients,
    approvals,
    mutationKey,
    errorCode,
    reload: () => reconcile(),
    setEnabled,
    createClient,
    patchClient,
    deleteClient,
    issueToken,
    decideApproval,
  }), [
    approvals,
    clients,
    createClient,
    decideApproval,
    deleteClient,
    errorCode,
    issueToken,
    mutationKey,
    patchClient,
    phase,
    reconcile,
    setEnabled,
    status,
  ])

  return <McpAccessRuntimeContext.Provider value={value}>{children}</McpAccessRuntimeContext.Provider>
}

function runtimeErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return 'MCP_RUNTIME_UNAVAILABLE'
  const code = Reflect.get(error, 'code')
  return typeof code === 'string' && code ? code : 'MCP_RUNTIME_UNAVAILABLE'
}
