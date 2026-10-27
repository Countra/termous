import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import type { Arguments } from './contracts.ts'

const desktopInput = /^termous\.desktops\.(?:pointer\.|keyboard\.|clipboard\.set_text$|resize$)/u

// 传输异常不能证明未执行；只提供原操作查询，不自动重发或泄露底层异常正文。
export function unconfirmedDispatch(name: string, callID: string, args: Arguments): AgentToolResult<unknown> {
  const input = name !== 'termous.desktops.pointer.position' && desktopInput.test(name)
  const output = { error: { code: input ? 'desktop_input_uncertain' : 'AGENT_TOOL_DELIVERY_UNCONFIRMED',
    message: 'The operation may have been dispatched, but its receipt was not confirmed. Inspect the original operation; do not repeat the business action.', retryable: false,
    execution: { phase: 'dispatch', dispatch: 'unknown', recovery: input ? { kind: 'query_operation', tool: 'termous.desktops.operations.get', arguments: { tool_call_id: callID } } : { kind: 'user_action' },
      ...(typeof args.client_request_id === 'string' ? { request_id: args.client_request_id } : {}),
    },
  } }
  const content = [{ type: 'text' as const, text: JSON.stringify(output) }]
  return { content, details: { kind: 'mcp', originalToolName: name, result: { isError: true, content, structuredContent: output } } }
}
