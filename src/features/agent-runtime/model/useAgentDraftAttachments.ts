import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentAttachment } from '#entities/agent'
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
}

export function useAgentDraftAttachments({
  gateway,
  ensureSession,
  onError,
  existingSelections,
}: {
  gateway: AgentWorkspaceGateway
  ensureSession: () => Promise<string>
  onError: (code: string) => void
  existingSelections?: (sessionId: string) => Array<Pick<AgentAttachment, 'kind' | 'size_bytes'>>
}) {
  const [records, setRecords] = useState<Record<string, AgentDraftAttachmentRecord[]>>({})
  const recordsRef = useRef(records)
  const uploadsRef = useRef(new Map<string, AbortController>())
  const deletesRef = useRef(new Set<string>())
  const pendingSelectionsRef = useRef(new Map<string, Map<string, AgentAttachmentSelection>>())
  const sessionGenerationsRef = useRef(new Map<string, number>())
  const mountedRef = useRef(true)
  const sequenceRef = useRef(0)
  recordsRef.current = records

  useEffect(() => {
    const uploads = uploadsRef.current
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      for (const controller of uploads.values()) controller.abort()
      uploads.clear()
    }
  }, [])

  const upload = useCallback(async (record: AgentDraftAttachmentRecord) => {
    const controller = new AbortController()
    uploadsRef.current.set(record.client_id, controller)
    try {
      const attachment = await gateway.uploadAttachment(record.session_id, record.file, controller.signal)
      updateRecord(setRecords, record.session_id, record.client_id, (current) => ({
        ...current, phase: 'ready', attachment, error_code: undefined,
      }))
    } catch (error) {
      if (controller.signal.aborted) return
      updateRecord(setRecords, record.session_id, record.client_id, (current) => ({
        ...current,
        phase: 'failed',
        error_code: errorCode(error),
      }))
    } finally {
      if (uploadsRef.current.get(record.client_id) === controller) uploadsRef.current.delete(record.client_id)
    }
  }, [gateway])

  const add = useCallback(async (files: File[]) => {
    try {
      const prevalidated = await validateAgentAttachmentSelection([], files)
      const sessionId = await ensureSession()
      const sessionGeneration = sessionGenerationsRef.current.get(sessionId) ?? 0
      const existing = recordsRef.current[sessionId] ?? []
      const pendingSelections = pendingSelectionsRef.current.get(sessionId) ?? new Map<string, AgentAttachmentSelection>()
      pendingSelectionsRef.current.set(sessionId, pendingSelections)
      const fingerprints = new Set([
        ...existing.map(({ file }) => fileFingerprint(file)),
        ...pendingSelections.keys(),
      ])
      const uniqueSelections = prevalidated.filter(({ file }) => {
        const fingerprint = fileFingerprint(file)
        if (fingerprints.has(fingerprint)) return false
        fingerprints.add(fingerprint)
        return true
      })
      if (uniqueSelections.length === 0) {
        if (pendingSelections.size === 0) pendingSelectionsRef.current.delete(sessionId)
        return
      }
      const previouslyPending = [...pendingSelections.values()]
      for (const selection of uniqueSelections) {
        pendingSelections.set(fileFingerprint(selection.file), selection)
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
        if (!mountedRef.current || (sessionGenerationsRef.current.get(sessionId) ?? 0) !== sessionGeneration) return
        const next = selections.map((selection) => createRecord(sessionId, selection, ++sequenceRef.current))
        setRecords((current) => ({
          ...current,
          [sessionId]: [...(current[sessionId] ?? []), ...next],
        }))
        await Promise.all(next.map(upload))
      } finally {
        for (const { file } of uniqueSelections) pendingSelections.delete(fileFingerprint(file))
        if (pendingSelections.size === 0) pendingSelectionsRef.current.delete(sessionId)
      }
    } catch (error) {
      onError(errorCode(error))
    }
  }, [ensureSession, existingSelections, onError, upload])

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
      await gateway.deleteAttachment(record.attachment.id, record.attachment.revision)
      setRecords((current) => removeRecord(current, record.session_id, clientId))
    } catch (error) {
      updateRecord(setRecords, record.session_id, clientId, (current) => ({ ...current, phase: 'ready' }))
      onError(errorCode(error))
    } finally {
      deletesRef.current.delete(clientId)
    }
  }, [gateway, onError])

  const retry = useCallback(async (clientId: string) => {
    const record = findRecord(recordsRef.current, clientId)
    if (!record || record.phase !== 'failed') return
    const retrying = { ...record, phase: 'uploading' as const, error_code: undefined }
    updateRecord(setRecords, record.session_id, clientId, () => retrying)
    await upload(retrying)
  }, [upload])

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
  }, [])

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
        ? [gateway.deleteAttachment(record.attachment.id, record.attachment.revision)]
        : []
    )))
    if (failures.some(({ status }) => status === 'rejected')) onError('AGENT_ATTACHMENT_DELETE_FAILED')
  }, [gateway, onError])

  return { records, add, remove, retry, clear, discard }
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
