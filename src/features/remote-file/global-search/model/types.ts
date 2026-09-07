import type {
  FileNameSearchCaseMode,
  FileNameSearchHiddenMode,
  FileNameSearchIgnoreMode,
  FileNameSearchMatchMode,
  FileNameSearchMatchTarget,
} from '#entities/file'
import type { FileNameSearchGateway } from '#features/files'

export interface GlobalFileSearchSource {
  fileSessionId: string
  connectionGeneration: number
  hostName: string
  currentPath: string
}

export interface GlobalFileSearchAdvancedFilters {
  searchRoot: string
  matchMode: FileNameSearchMatchMode
  caseMode: FileNameSearchCaseMode
  matchTarget: FileNameSearchMatchTarget
  hiddenMode: FileNameSearchHiddenMode
  ignoreMode: FileNameSearchIgnoreMode
  maxDepth: number
  extensions: string[]
  excludeGlobs: string[]
  modifiedAfter: string | null
  modifiedBefore: string | null
  minSizeBytes: number | null
  maxSizeBytes: number | null
}

export type GlobalFileSearchScope = 'system' | 'directory'

export type GlobalFileSearchRevealResult =
  | { status: 'revealed' }
  | { status: 'missing' }
  | { status: 'cancelled' }
  | { status: 'failed'; description: string }

export type GlobalFileSearchReveal = (
  path: string,
  signal: AbortSignal,
) => Promise<GlobalFileSearchRevealResult>

export interface GlobalFileSearchOpenRequest {
  ownerId: string
  source: GlobalFileSearchSource
  onReveal: GlobalFileSearchReveal
}

export interface GlobalFileSearchRuntimeValue {
  openSearch: (request: GlobalFileSearchOpenRequest) => void
  closeSearch: (ownerId: string) => void
}

export interface GlobalFileSearchModalProps {
  api: FileNameSearchGateway
  open: boolean
  source: GlobalFileSearchSource
  onReveal: GlobalFileSearchReveal
  onClose: () => void
}

export type FileNameSearchCapabilityPhase =
  | 'idle'
  | 'detecting'
  | 'installing'
  | 'verifying'
  | 'ready'
  | 'failed'

export type FileNameSearchPhase =
  | 'idle'
  | 'running'
  | 'stopping'
  | 'completed'
  | 'cancelled'
  | 'failed'
