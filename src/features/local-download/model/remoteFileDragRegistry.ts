export const REMOTE_FILE_DRAG_MIME = 'application/x-termous-remote-files'

export type RemoteFileConnectionGeneration = string | number

export interface RemoteFileDragSelection {
  fileSessionId: string
  hostId: string
  connectionGeneration: RemoteFileConnectionGeneration
  paths: readonly string[]
}

export interface RemoteFileDragTransaction {
  id: string
  fileSessionId: string
  hostId: string
  connectionGeneration: RemoteFileConnectionGeneration
  paths: readonly string[]
  createdAt: number
  expiresAt: number
}

export interface RemoteFileDragContext {
  connected: boolean
  fileSessionId: string
  hostId: string
  connectionGeneration: RemoteFileConnectionGeneration
}

export type RemoteFileDragValidationFailure =
  | 'disconnected'
  | 'empty'
  | 'session-mismatch'
  | 'host-mismatch'
  | 'connection-generation-mismatch'

export type RemoteFileDragValidation =
  | { ok: true; transaction: RemoteFileDragTransaction }
  | { ok: false; reason: RemoteFileDragValidationFailure }

interface RemoteFileDragRegistryOptions {
  now?: () => number
  createId?: () => string
  ttlMs?: number
  maxEntries?: number
}

const defaultTtlMs = 2 * 60 * 1000
const defaultMaxEntries = 96

export class RemoteFileDragRegistry {
  private readonly transactions = new Map<string, RemoteFileDragTransaction>()
  private readonly now: () => number
  private readonly createId: () => string
  private readonly ttlMs: number
  private readonly maxEntries: number

  constructor(options: RemoteFileDragRegistryOptions = {}) {
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? createRemoteFileDragId
    this.ttlMs = options.ttlMs ?? defaultTtlMs
    this.maxEntries = options.maxEntries ?? defaultMaxEntries
  }

  register(selection: RemoteFileDragSelection) {
    const paths = normalizeRemoteFileDragPaths(selection.paths)
    if (
      !selection.fileSessionId.trim()
      || !selection.hostId.trim()
      || paths.length === 0
    ) {
      throw new Error('Invalid remote file drag selection')
    }
    this.prune()
    while (this.transactions.size >= this.maxEntries) {
      const oldestId = this.transactions.keys().next().value
      if (typeof oldestId !== 'string') {
        break
      }
      this.transactions.delete(oldestId)
    }
    const createdAt = this.now()
    const transaction: RemoteFileDragTransaction = Object.freeze({
      id: this.createId(),
      fileSessionId: selection.fileSessionId,
      hostId: selection.hostId,
      connectionGeneration: selection.connectionGeneration,
      paths: Object.freeze(paths),
      createdAt,
      expiresAt: createdAt + this.ttlMs,
    })
    this.transactions.set(transaction.id, transaction)
    return transaction
  }

  resolve(id: string) {
    if (!id) {
      return null
    }
    const transaction = this.transactions.get(id)
    if (!transaction) {
      return null
    }
    if (transaction.expiresAt <= this.now()) {
      this.transactions.delete(id)
      return null
    }
    return transaction
  }

  release(id: string) {
    this.transactions.delete(id)
  }

  prune() {
    const now = this.now()
    this.transactions.forEach((transaction, id) => {
      if (transaction.expiresAt <= now) {
        this.transactions.delete(id)
      }
    })
  }

  clear() {
    this.transactions.clear()
  }

  get size() {
    this.prune()
    return this.transactions.size
  }
}

export const remoteFileDragRegistry = new RemoteFileDragRegistry()

export function beginRemoteFileDrag(
  dataTransfer: DataTransfer,
  selection: RemoteFileDragSelection,
  registry = remoteFileDragRegistry,
) {
  const transaction = registry.register(selection)
  dataTransfer.setData(REMOTE_FILE_DRAG_MIME, transaction.id)
  dataTransfer.effectAllowed = 'copyMove'
  return transaction
}

export function remoteFileDragTransactionId(dataTransfer: DataTransfer) {
  if (hasNativeFiles(dataTransfer) || !hasRemoteFileDragType(dataTransfer)) {
    return ''
  }
  return dataTransfer.getData(REMOTE_FILE_DRAG_MIME).trim()
}

export function resolveRemoteFileDrag(
  dataTransfer: DataTransfer,
  registry = remoteFileDragRegistry,
) {
  const transactionId = remoteFileDragTransactionId(dataTransfer)
  return transactionId ? registry.resolve(transactionId) : null
}

export function releaseRemoteFileDrag(
  transactionOrId: RemoteFileDragTransaction | string | null | undefined,
  registry = remoteFileDragRegistry,
) {
  if (!transactionOrId) {
    return
  }
  registry.release(typeof transactionOrId === 'string' ? transactionOrId : transactionOrId.id)
}

export function validateRemoteFileDrag(
  transaction: RemoteFileDragTransaction,
  context: RemoteFileDragContext,
): RemoteFileDragValidation {
  const reason = remoteFileSelectionValidationFailure(transaction, context)
  return reason
    ? { ok: false, reason }
    : { ok: true, transaction }
}

export function remoteFileSelectionValidationFailure(
  selection: RemoteFileDragSelection,
  context: RemoteFileDragContext,
): RemoteFileDragValidationFailure | null {
  if (!context.connected) {
    return 'disconnected'
  }
  if (selection.paths.length === 0) {
    return 'empty'
  }
  if (selection.fileSessionId !== context.fileSessionId) {
    return 'session-mismatch'
  }
  if (selection.hostId !== context.hostId) {
    return 'host-mismatch'
  }
  if (String(selection.connectionGeneration) !== String(context.connectionGeneration)) {
    return 'connection-generation-mismatch'
  }
  return null
}

export function hasRemoteFileDragType(dataTransfer: DataTransfer) {
  return dataTransferTypes(dataTransfer).includes(REMOTE_FILE_DRAG_MIME)
}

export function hasNativeFiles(dataTransfer: DataTransfer) {
  return dataTransferTypes(dataTransfer).includes('Files') || dataTransfer.files.length > 0
}

function dataTransferTypes(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types)
}

function normalizeRemoteFileDragPaths(paths: readonly string[]) {
  return [...new Set(paths.map((path) => path.trim()).filter(Boolean))]
}

function createRemoteFileDragId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const random = Math.random().toString(36).slice(2)
  return `remote-file-drag-${Date.now().toString(36)}-${random}`
}
