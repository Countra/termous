import type { RemoteDirectorySize } from '#entities/file'

export interface DirectorySizeSource {
  fileSessionId: string
  connectionGeneration: number
  path: string
  listingReadAt: string
}

export type DirectorySizeState =
  | { status: 'idle' }
  | { status: 'running'; ownerKey: string }
  | { status: 'success'; ownerKey: string; result: RemoteDirectorySize }
  | { status: 'error'; ownerKey: string; error: unknown }
