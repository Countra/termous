const connectionFailureMessages = new Map(Object.entries({
  AGENT_MCP_PROTOCOL_MISMATCH: 'AI 助手与 MCP 工具服务的协议版本不兼容',
  AGENT_MCP_ENDPOINT_INVALID: 'AI 助手的 MCP 工具服务地址无效',
  AGENT_MCP_ENDPOINT_VIOLATION: 'AI 助手的 MCP 工具服务地址不符合本地连接要求',
  AGENT_MCP_TOOL_NAME_CONFLICT: 'MCP 工具名称重复或无效，AI 助手未能启动',
  AGENT_MCP_TOOL_SCHEMA_INVALID: 'MCP 工具参数定义无效，AI 助手未能启动',
  AGENT_MCP_TOOLS_EMPTY: 'MCP 工具服务没有返回可用工具，AI 助手未能启动',
}))

export function projectWorkerMCPFailure(error: unknown): { code: string; message: string } {
  // 只识别适配器明确抛出的稳定码，避免把地址、凭据或工具定义带入持久化错误。
  const code = error instanceof Error ? error.message : ''
  const message = connectionFailureMessages.get(code)
  return message ? { code, message } : {
    code: 'AGENT_MCP_CONNECTION_FAILED',
    message: 'AI 助手连接 MCP 工具服务失败，请准备或修复后重试',
  }
}
