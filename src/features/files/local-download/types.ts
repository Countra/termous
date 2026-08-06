import type {
  LocalPathMapping,
  LocalPathMappingInput,
  LocalPathMappingReorderItem,
} from '#entities/file'
import type {
  LocalDownloadGateway,
} from '../api/fileGateway'
import type {
  RemoteFileConnectionGeneration,
  RemoteFileDragSelection,
} from './remoteFileDragRegistry'
import type {
  LocalDownloadRefreshRequest,
  LocalDownloadTargetPreference,
} from './useLocalDownloadWorkspace'

export interface LocalDownloadSessionContext {
  connected: boolean
  fileSessionId: string
  hostId: string
  connectionGeneration: RemoteFileConnectionGeneration
}

export interface LocalDownloadTarget {
  mappingId: string
  mappingName: string
  mappingPath: string
  path: string
  available: boolean
}

export interface LocalDownloadRequest {
  selection: RemoteFileDragSelection
  target: LocalDownloadTarget
  source: 'confirm' | 'drop'
}

export interface LocalDownloadConsoleProps {
  api: LocalDownloadGateway
  open: boolean
  mappings: readonly LocalPathMapping[]
  session: LocalDownloadSessionContext | null
  selection?: RemoteFileDragSelection | null
  preferredTarget?: LocalDownloadTargetPreference | null
  refreshRequests?: readonly LocalDownloadRefreshRequest[]
  operationBlocked?: boolean
  className?: string
  onClose: () => void
  onDownload: (request: LocalDownloadRequest, signal?: AbortSignal) => Promise<boolean>
  onDropActiveChange?: (active: boolean) => void
  onOperationActiveChange?: (active: boolean) => boolean | void
  onTargetChange?: (target: LocalDownloadTarget | null) => void
  onCreateMapping: (input: LocalPathMappingInput) => Promise<LocalPathMapping>
  onUpdateMapping: (id: string, input: LocalPathMappingInput) => Promise<LocalPathMapping>
  onDeleteMapping: (id: string) => Promise<void>
  onReorderMappings: (items: LocalPathMappingReorderItem[]) => Promise<LocalPathMapping[]>
}

export interface LocalDownloadQuickTargetProps {
  api: LocalDownloadGateway
  target: LocalDownloadTarget | null
  session: LocalDownloadSessionContext | null
  expanded: boolean
  disabled?: boolean
  className?: string
  onOpen: () => void
  onDownload: (request: LocalDownloadRequest, signal?: AbortSignal) => Promise<boolean>
  onDropActiveChange?: (active: boolean) => void
  onOperationActiveChange?: (active: boolean) => boolean | void
}
