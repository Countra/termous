import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  LocalFileGrant,
  LocalGrantItem,
  LocalGrantSource,
  RemoteFileEntry,
} from '#entities/file'
import { TermousApiError } from '#shared/api'
import { joinPath } from '#shared/path'

const uploadConflictStatConcurrency = 8

export type UploadConflictPolicy = 'rename' | 'overwrite'

export interface UploadFileConflict {
  incoming: LocalGrantItem
  existing: RemoteFileEntry
}

export interface UploadConflictRequest {
  conflicts: readonly UploadFileConflict[]
  targetPath: string
}

export interface UploadConflictDialogProps {
  open: boolean
  conflicts: readonly UploadFileConflict[]
  targetPath: string
  selectedPolicy: UploadConflictPolicy
  onPolicyChange: (policy: UploadConflictPolicy) => void
  onContinue: () => void
  onCancel: () => void
}

export interface UploadConflictWorkflowOptions<Task> {
  source: LocalGrantSource
  paths: readonly string[]
  targetPath: string
  createGrant: (source: LocalGrantSource, paths: string[]) => Promise<LocalFileGrant>
  releaseGrant: (id: string) => Promise<void>
  stat: (path: string) => Promise<RemoteFileEntry>
  requestPolicy: (request: UploadConflictRequest) => Promise<UploadConflictPolicy | null>
  isCurrent: () => boolean
  createUpload: (grantId: string, overwriteItemIds: string[]) => Promise<Task>
}

export function findUploadFileConflicts(
  items: readonly LocalGrantItem[],
  entries: readonly RemoteFileEntry[],
): UploadFileConflict[] {
  const incomingNameCounts = new Map<string, number>()
  for (const item of items) {
    incomingNameCounts.set(item.name, (incomingNameCounts.get(item.name) ?? 0) + 1)
  }
  const remoteFilesByName = new Map<string, RemoteFileEntry>()
  for (const entry of entries) {
    if (entry.kind === 'file' && !remoteFilesByName.has(entry.name)) {
      remoteFilesByName.set(entry.name, entry)
    }
  }

  return items.flatMap((incoming) => {
    if (incoming.kind !== 'file' || incomingNameCounts.get(incoming.name) !== 1) {
      return []
    }
    const existing = remoteFilesByName.get(incoming.name)
    return existing ? [{ incoming, existing }] : []
  })
}

export async function preflightUploadFileConflicts(
  items: readonly LocalGrantItem[],
  targetPath: string,
  stat: (path: string) => Promise<RemoteFileEntry>,
  isCurrent: () => boolean = () => true,
): Promise<UploadFileConflict[]> {
  const incomingNameCounts = new Map<string, number>()
  for (const item of items) {
    incomingNameCounts.set(item.name, (incomingNameCounts.get(item.name) ?? 0) + 1)
  }
  const incomingFiles = items.filter(
    (item) => item.kind === 'file' && incomingNameCounts.get(item.name) === 1,
  )
  const results = new Array<UploadFileConflict | undefined>(incomingFiles.length)
  let nextIndex = 0

  const inspectNext = async () => {
    while (nextIndex < incomingFiles.length) {
      if (!isCurrent()) {
        return
      }
      const index = nextIndex
      nextIndex += 1
      const incoming = incomingFiles[index]
      if (!incoming) {
        continue
      }

      try {
        const existing = await stat(joinPath(targetPath, incoming.name))
        if (!isCurrent()) {
          return
        }
        if (existing.kind === 'file' && existing.name === incoming.name) {
          results[index] = { incoming, existing }
        }
      } catch (error) {
        if (!isCurrent()) {
          return
        }
        if (error instanceof TermousApiError && error.code === 'SFTP_PATH_NOT_FOUND') {
          continue
        }
        throw error
      }
    }
  }

  const workerCount = Math.min(uploadConflictStatConcurrency, incomingFiles.length)
  await Promise.all(Array.from({ length: workerCount }, inspectNext))
  return isCurrent()
    ? results.filter((conflict): conflict is UploadFileConflict => conflict !== undefined)
    : []
}

export function remapConfirmedOverwriteItemIds(
  originalItems: readonly LocalGrantItem[],
  refreshedItems: readonly LocalGrantItem[],
  conflicts: readonly UploadFileConflict[],
): string[] | null {
  const confirmedIds = new Set(conflicts.map(({ incoming }) => incoming.id))
  const mappedIds: string[] = []

  for (let index = 0; index < originalItems.length; index += 1) {
    const original = originalItems[index]
    if (!original || !confirmedIds.has(original.id)) {
      continue
    }
    const refreshed = refreshedItems[index]
    if (
      !refreshed
      || original.kind !== 'file'
      || refreshed.kind !== 'file'
      || refreshed.name !== original.name
    ) {
      return null
    }
    mappedIds.push(refreshed.id)
  }

  return mappedIds.length === confirmedIds.size ? mappedIds : null
}

async function releaseUnusedGrant(
  releaseGrant: (id: string) => Promise<void>,
  id: string,
) {
  try {
    await releaseGrant(id)
  } catch {
    // 临时授权仍会由服务端的短期过期机制回收，清理失败不应覆盖主要上传结果。
  }
}

export async function createUploadWithConflictDecision<Task>(
  options: UploadConflictWorkflowOptions<Task>,
): Promise<Task | null> {
  let activeGrant: LocalFileGrant | null = null
  let grantIsOwned = false
  let invalidated = false
  const isCurrent = () => {
    if (!invalidated && !options.isCurrent()) {
      invalidated = true
    }
    return !invalidated
  }

  try {
    activeGrant = await options.createGrant(options.source, [...options.paths])
    grantIsOwned = true
    if (!isCurrent()) {
      return null
    }

    let conflicts: UploadFileConflict[]
    try {
      conflicts = await preflightUploadFileConflicts(
        activeGrant.items,
        options.targetPath,
        options.stat,
        isCurrent,
      )
    } catch (error) {
      if (!isCurrent()) {
        return null
      }
      throw error
    }
    if (!isCurrent()) {
      return null
    }

    const policy = await options.requestPolicy({ conflicts, targetPath: options.targetPath })
    if (!policy || !isCurrent()) {
      return null
    }

    let overwriteItemIds: string[] = []
    if (conflicts.length > 0) {
      const inspectedGrant = activeGrant
      await releaseUnusedGrant(options.releaseGrant, inspectedGrant.id)
      grantIsOwned = false
      if (!isCurrent()) {
        return null
      }

      activeGrant = await options.createGrant(options.source, [...options.paths])
      grantIsOwned = true
      if (!isCurrent()) {
        return null
      }

      if (policy === 'overwrite') {
        const mappedIds = remapConfirmedOverwriteItemIds(
          inspectedGrant.items,
          activeGrant.items,
          conflicts,
        )
        if (!mappedIds) {
          throw new Error('The selected local files changed before the upload could start')
        }
        overwriteItemIds = mappedIds
      }
    }

    const task = await options.createUpload(activeGrant.id, overwriteItemIds)
    grantIsOwned = false
    return task
  } finally {
    if (grantIsOwned && activeGrant) {
      await releaseUnusedGrant(options.releaseGrant, activeGrant.id)
    }
  }
}

export function useUploadConflictDecision() {
  const [request, setRequest] = useState<UploadConflictRequest | null>(null)
  const [selectedPolicy, setSelectedPolicy] = useState<UploadConflictPolicy>('rename')
  const resolverRef = useRef<((policy: UploadConflictPolicy | null) => void) | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      resolverRef.current?.(null)
      resolverRef.current = null
    }
  }, [])

  const closeWith = useCallback((policy: UploadConflictPolicy | null) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setRequest(null)
    resolve?.(policy)
  }, [])

  const requestPolicy = useCallback((nextRequest: UploadConflictRequest) => {
    if (!mountedRef.current) {
      return Promise.resolve<UploadConflictPolicy | null>(null)
    }

    if (resolverRef.current) {
      return Promise.resolve<UploadConflictPolicy | null>(null)
    }

    if (nextRequest.conflicts.length === 0) {
      setRequest(null)
      return Promise.resolve<UploadConflictPolicy | null>('rename')
    }

    setSelectedPolicy('rename')
    setRequest({
      conflicts: [...nextRequest.conflicts],
      targetPath: nextRequest.targetPath,
    })

    return new Promise<UploadConflictPolicy | null>((resolve) => {
      resolverRef.current = resolve
    })
  }, [])
  const cancelPending = useCallback(() => closeWith(null), [closeWith])

  return {
    requestPolicy,
    cancelPending,
    dialogProps: {
      open: request !== null,
      conflicts: request?.conflicts ?? [],
      targetPath: request?.targetPath ?? '',
      selectedPolicy,
      onPolicyChange: setSelectedPolicy,
      onContinue: () => closeWith(selectedPolicy),
      onCancel: () => closeWith(null),
    } satisfies UploadConflictDialogProps,
  }
}
