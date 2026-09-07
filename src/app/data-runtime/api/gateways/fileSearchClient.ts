import type { AppConfig } from '#common/contracts'
import type {
  FileNameSearchCapability,
  FileNameSearchInstallRequest,
  FileNameSearchRequest,
  FileNameSearchResult,
} from '#entities/file'
import { TermousApiTransport } from '#shared/api'

export class FileSearchClient extends TermousApiTransport {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

  fileNameSearchCapability(
    fileSessionId: string,
    connectionGeneration: number,
    signal?: AbortSignal,
  ) {
    const query = new URLSearchParams({
      expected_connection_generation: String(connectionGeneration),
    })
    return this.request<FileNameSearchCapability>(
      `/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/name-search/capability?${query.toString()}`,
      { signal, timeoutMs: 20_000 },
    )
  }

  searchFileSessionNames(
    fileSessionId: string,
    input: FileNameSearchRequest,
    signal?: AbortSignal,
  ) {
    return this.request<FileNameSearchResult>(
      `/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/name-search`,
      {
        method: 'POST',
        body: input,
        signal,
        timeoutMs: 130_000,
      },
    )
  }

  installFileNameSearch(
    fileSessionId: string,
    input: FileNameSearchInstallRequest,
    signal?: AbortSignal,
  ) {
    return this.request<FileNameSearchCapability>(
      `/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/name-search/install`,
      {
        method: 'POST',
        body: input,
        signal,
        timeoutMs: 10 * 60_000,
      },
    )
  }
}
