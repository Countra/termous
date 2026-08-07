import type {
  CompletionQuery,
  CompletionResult,
  CompletionStatus,
} from '#entities/session'

export interface TerminalGateway {
  terminalFontFileUrl(id: string, sha256?: string): string
  websocketUrl(path: string): string
  sessionCompletionStatus(
    id: string,
    options?: { signal?: AbortSignal },
  ): Promise<CompletionStatus>
  querySessionCompletions(
    id: string,
    query: CompletionQuery,
    options?: { signal?: AbortSignal },
  ): Promise<CompletionResult>
  refreshSessionCompletions(
    id: string,
    options?: { signal?: AbortSignal },
  ): Promise<CompletionStatus>
}
