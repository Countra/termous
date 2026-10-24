export interface PreparedCall {
  tool_call_id: string
  tool_name: string
  step: string
  request_id: string
  arguments_sha256: string
  values: Record<string, unknown>
  generation: number
  operation_result?: Record<string, unknown>
}
