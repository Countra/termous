export interface TerminalAIInputSnapshot {
  sourceGeneration: number
  shellId: string
  promptGeneration: number
  inputEpoch: number
  line: string
  cursorUtf16: number
  revision: number
}

export interface TerminalAICompletionRequest {
  requestId: string
  sessionId: string
  prompt: string
  inputSnapshot: TerminalAIInputSnapshot
}

export interface TerminalAICompletionCancel {
  requestId: string
  sessionId: string
}

export interface TerminalAICompletionModel {
  id: string
  name: string
  providerName: string
}

export type TerminalAICompletionResult = Pick<TerminalAICompletionRequest, 'requestId' | 'sessionId' | 'inputSnapshot'> & (
  | { status: 'completed'; command: string; description: string; model: TerminalAICompletionModel }
  | { status: 'failed' | 'cancelled'; code: string; message: string }
)
