import type {
  FileOperationTask,
  RemoteTextSaveRequest,
} from '#entities/file'

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
