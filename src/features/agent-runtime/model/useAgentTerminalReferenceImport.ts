import { useCallback, useEffect, useRef, useState } from 'react'
import { getAgentResourceBinding, resourceReference, resourceReferenceId, sameAgentResourceSource, type AgentLaunchIntent, type AgentSession, type AgentResourceState, type AgentResourceReferenceLaunch, type AgentTerminalReferenceLaunch } from '#entities/agent'
import type { AgentWorkspaceController } from '../runtime/AgentWorkspaceController.ts'
import { projectAgentReferenceTargets, terminalReferenceBindingKey, terminalReferenceChangesBinding, validateTerminalReferenceText } from './agentTerminalReference.ts'

type ReferenceIntent = Extract<AgentLaunchIntent, { source: 'terminal_selection' | 'connection_reference' }>
export interface AgentTerminalReferenceImportJob {
  request: ReferenceIntent
  stage: 'pending' | 'configuration' | 'confirm' | 'importing' | 'failed'
  targetId?: string
  ownerId?: string
  confirmation?: AgentSession
  approvedBindingKey?: string
  errorCode?: string
}

interface Options {
  intent?: ReferenceIntent
  controller: AgentWorkspaceController
  active: boolean
  ready: boolean
  modelReady: boolean
  resourcesReady: boolean
  resources: AgentResourceState[]
  createSession: (request: AgentResourceReferenceLaunch) => Promise<AgentSession>
  getOwnerId: (sessionId: string) => string
  addReference: (sessionId: string, request: AgentTerminalReferenceLaunch, ownerId: string) => Promise<boolean>
  onHandled?: (key: number) => void
  onFocus: () => void
}

export function useAgentTerminalReferenceImport(options: Options) {
  const [jobs, setJobs] = useState<AgentTerminalReferenceImportJob[]>([])
  const optionsRef = useRef(options)
  const acceptedRef = useRef(new Set<number>())
  const cancelledRef = useRef(new Set<number>())
  const busyRef = useRef(false)
  const mountedRef = useRef(true)
  optionsRef.current = options
  const current = jobs[0]

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    const intent = options.intent
    if (!intent || acceptedRef.current.has(intent.key)) return
    acceptedRef.current.add(intent.key)
    const ownerId = intent.source === 'terminal_selection' && intent.target.kind === 'session'
      ? optionsRef.current.getOwnerId(intent.target.session_id)
      : undefined
    // 接管时固定编辑归属，等待前一个引用、会话查询或换绑确认期间也不能改投新草稿。
    setJobs((previous) => [...previous, { request: intent, stage: 'pending', ownerId }])
    // 接管到常驻页面后释放导航意图；去设置页时原文仍由当前导入持有。
    optionsRef.current.onHandled?.(intent.key)
  }, [options.intent])

  const update = useCallback((key: number, patch: Partial<AgentTerminalReferenceImportJob>) => {
    if (!mountedRef.current) return
    setJobs((previous) => previous.map((job) => job.request.key === key ? { ...job, ...patch } : job))
  }, [])

  const execute = useCallback(async (job: AgentTerminalReferenceImportJob) => {
    if (busyRef.current) return
    busyRef.current = true
    const key = job.request.key
    const { controller } = optionsRef.current
    const selectionRevision = controller.getSnapshot().selection_intent_revision
    const alive = () => mountedRef.current && !cancelledRef.current.has(key)
    const requireSource = () => {
      const value = optionsRef.current
      if (!value.resourcesReady || !sameAgentResourceSource(job.request.source_resource,
        value.resources.find((source) => resourceReference(source).kind === job.request.resource_reference.kind
          && resourceReferenceId(resourceReference(source)) === resourceReferenceId(job.request.resource_reference)))) {
        throw new Error('AGENT_TERMINAL_REFERENCE_SOURCE_UNAVAILABLE')
      }
    }
    update(key, { stage: 'importing', errorCode: undefined })
    let targetId = job.targetId
    let ownerId = job.ownerId
    try {
      if (job.request.source === 'terminal_selection') validateTerminalReferenceText(job.request)
      requireSource()
      let created = false
      let session: AgentSession | undefined
      if (targetId || job.request.target.kind === 'session') {
        targetId ??= job.request.target.kind === 'session' ? job.request.target.session_id : undefined
        session = await controller.reloadSession(targetId!)
      } else {
        session = await optionsRef.current.createSession(job.request)
        targetId = session.id
        created = true
        ownerId = job.request.source === 'terminal_selection' ? optionsRef.current.getOwnerId(targetId) : undefined
        update(key, { targetId, ownerId })
      }
      if (!alive()) return
      if (!session || session.archived_at) throw new Error('AGENT_TERMINAL_REFERENCE_TARGET_UNAVAILABLE')
      targetId = session.id
      requireSource()
      if (job.request.source === 'terminal_selection' && (ownerId === undefined || optionsRef.current.getOwnerId(targetId) !== ownerId)) throw new Error('AGENT_TERMINAL_REFERENCE_EDIT_CHANGED')
      const changesBinding = terminalReferenceChangesBinding(session, job.request)
      const target = projectAgentReferenceTargets(controller.getSnapshot(), true).targets.find(({ session_id }) => session_id === targetId)
      if (!target) throw new Error('AGENT_TERMINAL_REFERENCE_TARGET_UNAVAILABLE')
      if (changesBinding && target.binding_locked) throw new Error('AGENT_TERMINAL_REFERENCE_BINDING_LOCKED')
      if (changesBinding && getAgentResourceBinding(session.resource_bindings, job.request.resource_reference.kind)
        && job.approvedBindingKey !== terminalReferenceBindingKey(session, job.request.resource_reference.kind)) {
        update(key, { stage: 'confirm', targetId, confirmation: session })
        return
      }
      if (!created) {
        await controller.replaceResourceBinding(targetId, {
          ...job.request.resource_reference, expected_revision: session.revision,
        })
      }
      if (!alive()) return
      requireSource()
      const latest = controller.getSnapshot()
      const latestSession = latest.sessions.find((candidate) => candidate.id === targetId && !candidate.archived_at)
      if (!latestSession) {
        throw new Error('AGENT_TERMINAL_REFERENCE_TARGET_UNAVAILABLE')
      }
      if (terminalReferenceChangesBinding(latestSession, job.request)) throw new Error('AGENT_REVISION_CONFLICT')
      if (job.request.source === 'terminal_selection' && optionsRef.current.getOwnerId(targetId) !== ownerId) throw new Error('AGENT_TERMINAL_REFERENCE_EDIT_CHANGED')
      const ownsSelection = created
        ? latest.selection_intent_revision === selectionRevision + 1 && latest.selected_session_id === targetId
        : latest.selection_intent_revision === selectionRevision
      if (ownsSelection && optionsRef.current.active && latest.selected_session_id !== targetId) controller.selectSession(targetId)
      const focusRevision = controller.getSnapshot().selection_intent_revision
      const added = job.request.source === 'terminal_selection'
        ? await optionsRef.current.addReference(targetId, job.request, ownerId!) : true
      if (!alive()) return
      if (!added) throw new Error('AGENT_TERMINAL_REFERENCE_ATTACHMENT_REJECTED')
      setJobs((previous) => previous.filter((candidate) => candidate.request.key !== key))
      const completed = controller.getSnapshot()
      if (ownsSelection && optionsRef.current.active && completed.selected_session_id === targetId
        && completed.selection_intent_revision === focusRevision) optionsRef.current.onFocus()
    } catch (error) {
      if (!alive()) return
      // 对账只更新服务器实体，不自动重试绑定，也不回滚其他窗口可能已经接受的修改。
      if (targetId) await controller.reloadSession(targetId).catch(() => undefined)
      if (!alive()) return
      update(key, { stage: 'failed', targetId, errorCode: referenceErrorCode(error) })
    } finally {
      busyRef.current = false
    }
  }, [update])

  useEffect(() => {
    if (!current || !options.active || !options.ready || !options.resourcesReady || busyRef.current) return
    if (current.stage !== 'pending' && current.stage !== 'configuration') return
    if (!current.targetId && current.request.target.kind === 'new' && !options.modelReady) {
      if (current.stage !== 'configuration') update(current.request.key, { stage: 'configuration' })
      return
    }
    void execute(current)
  }, [current, execute, options.active, options.modelReady, options.ready, options.resourcesReady, update])

  return {
    current,
    confirm: () => {
      if (!current?.confirmation) return
      update(current.request.key, { stage: 'pending', approvedBindingKey: terminalReferenceBindingKey(current.confirmation, current.request.resource_reference.kind), confirmation: undefined })
    },
    retry: () => {
      if (!current || current.stage !== 'failed') return
      const targetId = current.targetId ?? (current.request.target.kind === 'session' ? current.request.target.session_id : undefined)
      // 只有用户主动重试才重新接受当前编辑归属，旧请求的迟到回执不能自行切换。
      update(current.request.key, { stage: 'pending', errorCode: undefined,
        ownerId: current.request.source === 'terminal_selection' && targetId ? optionsRef.current.getOwnerId(targetId) : undefined })
    },
    dismiss: () => {
      if (!current || current.stage === 'importing') return
      cancelledRef.current.add(current.request.key)
      setJobs((previous) => previous.filter((job) => job.request.key !== current.request.key))
    },
  }
}

function referenceErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code
  return error instanceof Error ? error.message : 'AGENT_TERMINAL_REFERENCE_FAILED'
}
