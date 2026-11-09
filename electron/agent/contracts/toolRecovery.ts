export type ToolRecoveryKind = 'wait' | 'reread' | 'correct_parameters' | 'approval' | 'query_operation' | 'user_action' | 'none'

export interface ToolRecovery {
  kind: ToolRecoveryKind
  tool?: string
  arguments?: Record<string, unknown>
}

export interface ResourceRoutingFailure extends Record<string, unknown> {
  code: string
  message: string
  dispatched: boolean
  required_tool?: string
  required_arguments?: Record<string, unknown>
  expected_arguments?: Record<string, unknown>
}

// 保留 SDK 可读的错误正文；准备层只接受此本地类型，不解析任意异常中的 JSON 指令。
export class ResourceRoutingError extends Error {
  readonly failure: ResourceRoutingFailure
  constructor(failure: ResourceRoutingFailure) {
    super(JSON.stringify(failure))
    this.failure = failure
  }
}
