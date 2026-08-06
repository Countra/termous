import type {
  FileOperationTask,
  FileSession,
  LocalFileGrant,
  LocalGrantSource,
  LocalTreeEntry,
  OverwritePolicy,
  RemoteDirectoryListing,
  RemoteFileEntry,
  RemoteTextSaveRequest,
  TransferTask,
} from '#entities/file'

export interface FileSessionGateway {
  getFileSession: (id: string) => Promise<FileSession>
  fileSessionEventsUrl: (id: string) => string
  listFileSessionFiles: (
    fileSessionId: string,
    path: string,
    options?: { signal?: AbortSignal },
  ) => Promise<RemoteDirectoryListing>
  mkdirFileSessionFile: (fileSessionId: string, path: string) => Promise<void>
  renameFileSessionFile: (
    fileSessionId: string,
    sourcePath: string,
    targetPath: string,
  ) => Promise<void>
  chmodFileSessionFile: (
    fileSessionId: string,
    path: string,
    mode: string,
  ) => Promise<RemoteFileEntry>
  deleteFileSessionFiles: (
    fileSessionId: string,
    paths: string[],
    recursive?: boolean,
  ) => Promise<void>
  copyFileSessionFiles: (
    fileSessionId: string,
    sourcePaths: string[],
    targetDir: string,
    overwritePolicy?: OverwritePolicy,
  ) => Promise<void>
  moveFileSessionFiles: (
    fileSessionId: string,
    sourcePaths: string[],
    targetDir: string,
    overwritePolicy?: OverwritePolicy,
  ) => Promise<void>
}

export interface FileOperationGateway {
  createFileSessionTextReadOperation: (
    fileSessionId: string,
    path: string,
    signal?: AbortSignal,
  ) => Promise<FileOperationTask>
  createFileSessionTextSaveOperation: (
    fileSessionId: string,
    body: RemoteTextSaveRequest,
    signal?: AbortSignal,
  ) => Promise<FileOperationTask>
  createFileSessionImageReadOperation: (
    fileSessionId: string,
    path: string,
  ) => Promise<FileOperationTask>
  fileOperation: (id: string) => Promise<FileOperationTask>
  fileOperationResult: <Result>(id: string) => Promise<Result>
  fileOperationBlobResult: (id: string) => Promise<Blob>
  cancelFileOperation: (id: string) => Promise<void>
  fileOperationEventsUrl: (fileSessionId: string) => string
}

export interface FileTransferGateway {
  createLocalFileGrant: (
    source: LocalGrantSource,
    paths: string[],
  ) => Promise<LocalFileGrant>
  createFileSessionUploadTransfer: (
    fileSessionId: string,
    localGrantId: string,
    remoteDir: string,
    overwritePolicy?: OverwritePolicy,
  ) => Promise<TransferTask>
  createFileSessionDownloadTransfer: (
    fileSessionId: string,
    remotePaths: string[],
    localDir: string,
    overwritePolicy?: OverwritePolicy,
    signal?: AbortSignal,
  ) => Promise<TransferTask>
  retryTransfer: (id: string) => Promise<TransferTask>
  deleteTransfer: (id: string) => Promise<void>
}

export interface LocalPathMappingGateway {
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

export type FileGateway = FileSessionGateway
  & FileOperationGateway
  & FileTransferGateway
  & LocalPathMappingGateway

export type LocalDownloadGateway = LocalPathMappingGateway
