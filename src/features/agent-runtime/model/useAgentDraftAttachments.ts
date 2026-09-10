import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentAttachment, AgentTerminalReferenceOrigin } from '#entities/agent'
import { isAgentTerminalReferenceOrigin } from '#common/contracts'
import type { AgentWorkspaceGateway } from '../api/agentRuntimeGateway.ts'
import {
  AgentAttachmentSelectionError,
  validateAgentAttachmentSelection,
  type AgentAttachmentKind,
  type AgentAttachmentSelection,
} from './agentAttachmentPolicy.ts'

export interface AgentDraftAttachmentRecord {
  client_id: string
  session_id: string
  file: File
  kind: AgentAttachmentKind
  phase: 'uploading' | 'ready' | 'failed' | 'deleting'
  attachment?: AgentAttachment
  error_code?: string
  origin?: AgentTerminalReferenceOrigin
  owner_id?: string
}

type PendingAttachmentSelection = AgentAttachmentSelection & { owner_id?: string }
export interface AgentDraftAttachmentTarget {
  sessionId: string
  ownerId?: string
}

export function useAgentDraftAttachments({
  gateway,
  ensureSession,
  onError,
  existingSelections,
  getOwnerId,
}: {
  gateway: AgentWorkspaceGateway
  ensureSession: () => Promise<string>
  onError: (code: string) => void
  existingSelections?: (sessionId: string) => Array<Pick<AgentAttachment, 'kind' | 'size_bytes'>>
  getOwnerId?: (sessionId: string) => string | undefined
}) {
  const [records, setRecordsState] = useState<Record<string, AgentDraftAttachmentRecord[]>>({})
  const recordsRef = useRef(records)
  const setRecords = useCallback<React.Dispatch<React.SetStateAction<typeof records>>>((update) => {
    const next = typeof update === 'function' ? update(recordsRef.current) : update
    recordsRef.current = next
    setRecordsState(next)
  }, [])
  const uploadsRef = useRef(new Map<string, AbortController>())
  const deletesRef = useRef(new Set<string>())
  const deletionRequestsRef = useRef(new Map<string, Promise<void>>())
  const pendingSelectionsRef = useRef(new Map<string, Map<string, PendingAttachmentSelection>>())
  const sessionGenerationsRef = useRef(new Map<string, number>())
  const mountedRef = useRef(true)
  const sequenceRef = useRef(0)
  const ownerRef = useRef(getOwnerId)
  ownerRef.current = getOwnerId

  useEffect(() => {
    const uploads = uploadsRef.current
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      for (const controller of uploads.values()) controller.abort()
      uploads.clear()
    }
  }, [])

  const deleteUploaded = useCallback((attachment: AgentAttachment) => {
    const key = `${attachment.id}:${attachment.revision}`
    const existing = deletionRequestsRef.current.get(key)
    if (existing) return existing
    const operation = Promise.resolve()
      .then(() => gateway.deleteAttachment(attachment.id, attachment.revision))
      .finally(() => {
        if (deletionRequestsRef.current.get(key) === operation) deletionRequestsRef.current.delete(key)
      })
    deletionRequestsRef.current.set(key, operation)
    return operation
  }, [gateway])

  const upload = useCallback(async (record: AgentDraftAttachmentRecord) => {
    const ownerIsCurrent = () => !ownerRef.current || ownerRef.current(record.session_id) === record.owner_id
    if (!ownerIsCurrent()) return
    const controller = new AbortController()
    uploadsRef.current.set(record.client_id, controller)
    try {
      const attachment = await gateway.uploadAttachment(record.session_id, record.file, controller.signal, record.origin)
      if (controller.signal.aborted || !mountedRef.current || !ownerIsCurrent()) {
        // 已落盘但尚未交付草稿的回执仍须清理；不触及已提交的附件或其他现存记录。
        const alreadyOwned = Object.values(recordsRef.current).some((items) => items.some((item) => item.attachment?.id === attachment.id))
        if (!alreadyOwned && attachment.state === 'ready') {
          await deleteUploaded(attachment).catch(() => {
            if (mountedRef.current) onError('AGENT_ATTACHMENT_DELETE_FAILED')
          })
        }
        return
      }
      updateRecord(setRecords, record.session_id, record.client_id, (current) => ({
        ...current, phase: 'ready', attachment, error_code: undefined,
      }))
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current || !ownerIsCurrent()) return
      updateRecord(setRecords, record.session_id, record.client_id, (current) => ({
        ...current,
        phase: 'failed',
        error_code: errorCode(error),
      }))
    } finally {
      if (uploadsRef.current.get(record.client_id) === controller) uploadsRef.current.delete(record.client_id)
    }
  }, [deleteUploaded, gateway, onError, setRecords])

  const add = useCallback(async (files: File[], target?: AgentDraftAttachmentTarget, canEnsureSession?: () => boolean) => {
    const targetGeneration = target ? sessionGenerationsRef.current.get(target.sessionId) ?? 0 : undefined
    const canResolveTarget = () => Boolean(target) || !canEnsureSession || canEnsureSession()
    let resolvingSession = false
    const targetIsCurrent = () => mountedRef.current && (!target || (
      (sessionGenerationsRef.current.get(target.sessionId) ?? 0) === targetGeneration
      && (!ownerRef.current || ownerRef.current(target.sessionId) === target.ownerId)
    ))
    if (!targetIsCurrent() || !canResolveTarget()) return
    try {
      const prevalidated = await validateAgentAttachmentSelection([], files)
      if (!targetIsCurrent() || !canResolveTarget()) return
      // 创建会话会合法推进选择版本；外部草稿守卫只约束开始解析目标之前。
      resolvingSession = true
      const sessionId = target?.sessionId ?? await ensureSession()
      const ownerId = target ? target.ownerId : ownerRef.current?.(sessionId)
      const sessionGeneration = sessionGenerationsRef.current.get(sessionId) ?? 0
      const existing = (recordsRef.current[sessionId] ?? []).filter((record) => record.owner_id === ownerId)
      const pendingSelections = pendingSelectionsRef.current.get(sessionId) ?? new Map<string, PendingAttachmentSelection>()
      pendingSelectionsRef.current.set(sessionId, pendingSelections)
      const fingerprints = new Set([
        ...existing.filter(({ origin }) => !origin).map(({ file }) => selectionKey(file, ownerId)),
        ...pendingSelections.keys(),
      ])
      const uniqueSelections = prevalidated.filter(({ file }) => {
        const fingerprint = selectionKey(file, ownerId)
        if (fingerprints.has(fingerprint)) return false
        fingerprints.add(fingerprint)
        return true
      })
      if (uniqueSelections.length === 0) {
        if (pendingSelections.size === 0 && pendingSelectionsRef.current.get(sessionId) === pendingSelections) pendingSelectionsRef.current.delete(sessionId)
        return
      }
      const previouslyPending = [...pendingSelections.values()].filter((selection) => selection.owner_id === ownerId)
      for (const selection of uniqueSelections) {
        pendingSelections.set(selectionKey(selection.file, ownerId), { ...selection, owner_id: ownerId })
      }
      let reservationReleased = false
      const releaseReservation = () => {
        if (reservationReleased) return
        reservationReleased = true
        for (const { file } of uniqueSelections) pendingSelections.delete(selectionKey(file, ownerId))
      }
      try {
        const selections = await validateAgentAttachmentSelection(
          [
            ...(existingSelections?.(sessionId) ?? []),
            ...existing.map(({ kind, file }) => ({ kind, size_bytes: file.size })),
            ...previouslyPending.map(({ kind, file }) => ({ kind, size_bytes: file.size })),
          ],
          uniqueSelections.map(({ file }) => file),
        )
        if (!mountedRef.current || (sessionGenerationsRef.current.get(sessionId) ?? 0) !== sessionGeneration
          || ownerRef.current?.(sessionId) !== ownerId) return
        const next = selections.map((selection) => ({ ...createRecord(sessionId, selection, ++sequenceRef.current), owner_id: ownerId }))
        setRecords((current) => ({
          ...current,
          [sessionId]: [...(current[sessionId] ?? []), ...next],
        }))
        releaseReservation()
        await Promise.all(next.map(upload))
      } finally {
        releaseReservation()
        if (pendingSelections.size === 0 && pendingSelectionsRef.current.get(sessionId) === pendingSelections) pendingSelectionsRef.current.delete(sessionId)
      }
    } catch (error) {
      if (targetIsCurrent() && (resolvingSession || canResolveTarget())) onError(errorCode(error))
    }
  }, [ensureSession, existingSelections, onError, setRecords, upload])

  const addTerminalReference = useCallback(async (
    sessionId: string,
    reference: { text: string; origin: AgentTerminalReferenceOrigin },
    ownerId?: string,
  ): Promise<boolean> => {
    const generation = sessionGenerationsRef.current.get(sessionId) ?? 0
    const isCurrent = () => mountedRef.current
      && (sessionGenerationsRef.current.get(sessionId) ?? 0) === generation
      && (!ownerRef.current || ownerRef.current(sessionId) === ownerId)
    if (!isCurrent()) return false
    const pendingKey = `terminal-reference-${++sequenceRef.current}`
    const pending = pendingSelectionsRef.current.get(sessionId) ?? new Map<string, PendingAttachmentSelection>()
    try {
      if (!isAgentTerminalReferenceOrigin(reference.origin)
        || reference.text.split('\n').length !== reference.origin.line_count) {
        throw new AgentAttachmentSelectionError('AGENT_ATTACHMENT_ORIGIN_INVALID')
      }
      // 引用意图由调用方幂等；不同终端即使原文、时间相同也不得按文件指纹去重。
      const origin = { ...reference.origin }
      const file = new File([reference.text], 'terminal-reference.txt', { type: 'text/plain' })
      const existing = [
        ...(existingSelections?.(sessionId) ?? []),
        ...(recordsRef.current[sessionId] ?? []).filter((record) => record.owner_id === ownerId).map(({ kind, file: value }) => ({ kind, size_bytes: value.size })),
        ...[...pending.values()].filter((selection) => selection.owner_id === ownerId).map(({ kind, file: value }) => ({ kind, size_bytes: value.size })),
      ]
      pending.set(pendingKey, { kind: 'text', file, owner_id: ownerId })
      pendingSelectionsRef.current.set(sessionId, pending)
      const [selection] = await validateAgentAttachmentSelection(existing, [file])
      if (!selection || !isCurrent()) return false
      const record = { ...createRecord(sessionId, selection, ++sequenceRef.current), origin, owner_id: ownerId }
      // 同步可见的预留计数，避免并发导入在 React 提交前越过附件数量限制。
      const next = { ...recordsRef.current, [sessionId]: [...(recordsRef.current[sessionId] ?? []), record] }
      setRecords(next)
      pending.delete(pendingKey)
      await upload(record)
      return isCurrent()
    } catch (error) {
      if (isCurrent()) onError(errorCode(error))
      return false
    } finally {
      pending.delete(pendingKey)
      if (pending.size === 0 && pendingSelectionsRef.current.get(sessionId) === pending) {
        pendingSelectionsRef.current.delete(sessionId)
      }
    }
  }, [existingSelections, onError, setRecords, upload])

  const remove = useCallback(async (clientId: string) => {
    const record = findRecord(recordsRef.current, clientId)
    if (!record || deletesRef.current.has(clientId)) return
    uploadsRef.current.get(clientId)?.abort()
    uploadsRef.current.delete(clientId)
    if (!record.attachment) {
      setRecords((current) => removeRecord(current, record.session_id, clientId))
      return
    }
    deletesRef.current.add(clientId)
    updateRecord(setRecords, record.session_id, clientId, (current) => ({ ...current, phase: 'deleting' }))
    try {
      await deleteUploaded(record.attachment)
      setRecords((current) => removeRecord(current, record.session_id, clientId))
    } catch (error) {
      updateRecord(setRecords, record.session_id, clientId, (current) => ({ ...current, phase: 'ready' }))
      onError(errorCode(error))
    } finally {
      deletesRef.current.delete(clientId)
    }
  }, [deleteUploaded, onError, setRecords])

  const retry = useCallback(async (clientId: string) => {
    const record = findRecord(recordsRef.current, clientId)
    if (!record || record.phase !== 'failed') return
    if (ownerRef.current && ownerRef.current(record.session_id) !== record.owner_id) return
    const retrying = { ...record, phase: 'uploading' as const, error_code: undefined }
    updateRecord(setRecords, record.session_id, clientId, () => retrying)
    await upload(retrying)
  }, [setRecords, upload])

  const clear = useCallback((sessionId: string) => {
    bumpSessionGeneration(sessionGenerationsRef.current, sessionId)
    pendingSelectionsRef.current.delete(sessionId)
    for (const record of recordsRef.current[sessionId] ?? []) {
      uploadsRef.current.get(record.client_id)?.abort()
      uploadsRef.current.delete(record.client_id)
    }
    setRecords((current) => {
      const next = { ...current }
      delete next[sessionId]
      return next
    })
  }, [setRecords])

  const clearCommitted = useCallback((sessionId: string, attachmentIds: readonly string[]) => {
    if (attachmentIds.length === 0) return
    const committed = new Set(attachmentIds)
    // 提交回执只收口请求快照中的附件，保留等待期间追加的引用和本地校验。
    setRecords((current) => {
      const existing = current[sessionId]
      if (!existing) return current
      const remaining = existing.filter((record) => !record.attachment || !committed.has(record.attachment.id))
      if (remaining.length === existing.length) return current
      const next = { ...current }
      if (remaining.length) next[sessionId] = remaining
      else delete next[sessionId]
      return next
    })
  }, [setRecords])

  const discard = useCallback(async (sessionId: string) => {
    bumpSessionGeneration(sessionGenerationsRef.current, sessionId)
    pendingSelectionsRef.current.delete(sessionId)
    const sessionRecords = recordsRef.current[sessionId] ?? []
    for (const record of sessionRecords) {
      uploadsRef.current.get(record.client_id)?.abort()
      uploadsRef.current.delete(record.client_id)
    }
    setRecords((current) => {
      const next = { ...current }
      delete next[sessionId]
      return next
    })
    const failures = await Promise.allSettled(sessionRecords.flatMap((record) => (
      record.attachment
        ? [deleteUploaded(record.attachment)]
        : []
    )))
    if (failures.some(({ status }) => status === 'rejected')) onError('AGENT_ATTACHMENT_DELETE_FAILED')
  }, [deleteUploaded, onError, setRecords])

  const discardOwner = useCallback(async (sessionId: string, ownerId: string, committed = false) => {
    const owned = (recordsRef.current[sessionId] ?? []).filter((record) => record.owner_id === ownerId)
    const pending = pendingSelectionsRef.current.get(sessionId)
    for (const [key, selection] of pending ?? []) {
      if (selection.owner_id === ownerId) pending?.delete(key)
    }
    if (pending?.size === 0) pendingSelectionsRef.current.delete(sessionId)
    for (const record of owned) {
      uploadsRef.current.get(record.client_id)?.abort()
      uploadsRef.current.delete(record.client_id)
    }
    // 旧编辑的清理只删除其拥有的记录，不能推进整个会话代次或覆盖新编辑的上传。
    setRecords((current) => {
      const remaining = (current[sessionId] ?? []).filter((record) => record.owner_id !== ownerId)
      const next = { ...current }
      if (remaining.length) next[sessionId] = remaining
      else delete next[sessionId]
      return next
    })
    if (committed) return
    const deleted = await Promise.allSettled(owned.flatMap(({ attachment }) => attachment
      ? [deleteUploaded(attachment)] : []))
    if (deleted.some(({ status }) => status === 'rejected')) onError('AGENT_ATTACHMENT_DELETE_FAILED')
  }, [deleteUploaded, onError, setRecords])

  return { records, add, addTerminalReference, remove, retry, clear, clearCommitted, discard, discardOwner }
}

function createRecord(sessionId: string, selection: AgentAttachmentSelection, sequence: number): AgentDraftAttachmentRecord {
  return {
    client_id: `draft-attachment-${Date.now().toString(36)}-${sequence.toString(36)}`,
    session_id: sessionId,
    file: selection.file,
    kind: selection.kind,
    phase: 'uploading',
  }
}

function updateRecord(
  setRecords: React.Dispatch<React.SetStateAction<Record<string, AgentDraftAttachmentRecord[]>>>,
  sessionId: string,
  clientId: string,
  update: (record: AgentDraftAttachmentRecord) => AgentDraftAttachmentRecord,
) {
  setRecords((current) => {
    const records = current[sessionId]
    if (!records?.some(({ client_id }) => client_id === clientId)) return current
    return {
      ...current,
      [sessionId]: records.map((record) => record.client_id === clientId ? update(record) : record),
    }
  })
}

function removeRecord(
  records: Record<string, AgentDraftAttachmentRecord[]>,
  sessionId: string,
  clientId: string,
) {
  const remaining = (records[sessionId] ?? []).filter(({ client_id }) => client_id !== clientId)
  if (remaining.length > 0) return { ...records, [sessionId]: remaining }
  const next = { ...records }
  delete next[sessionId]
  return next
}

function findRecord(records: Record<string, AgentDraftAttachmentRecord[]>, clientId: string) {
  return Object.values(records).flat().find(({ client_id }) => client_id === clientId)
}

function fileFingerprint(file: File) {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`
}

function selectionKey(file: File, ownerId?: string) {
  return `${ownerId ?? ''}\u0000${fileFingerprint(file)}`
}

function errorCode(error: unknown) {
  if (error instanceof AgentAttachmentSelectionError) return error.code
  if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code
  }
  return 'unknown'
}

function bumpSessionGeneration(generations: Map<string, number>, sessionId: string) {
  generations.set(sessionId, (generations.get(sessionId) ?? 0) + 1)
}
