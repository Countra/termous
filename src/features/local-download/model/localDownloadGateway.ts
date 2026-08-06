import type { LocalTreeEntry } from '#entities/file'

export interface LocalDownloadGateway {
  localPathMappingChildren: (
    id: string,
    path?: string,
    signal?: AbortSignal,
  ) => Promise<LocalTreeEntry[]>
  localPathMappingStat: (
    id: string,
    path?: string,
    signal?: AbortSignal,
  ) => Promise<LocalTreeEntry>
}
