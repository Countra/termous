import { fail, type Arguments, type PreparationContext } from '../contracts.ts'

export async function prepareDesktopExecution(ctx: PreparationContext, args: Arguments) {
  if (args.execution_id !== undefined) return
  const original = await ctx.lookup(String(args.tool_call_id), 'dispatch')
  if (!original || original.tool_name !== 'termous.desktops.execute') fail('AGENT_OPERATION_NOT_FOUND', 'No original desktop batch is registered for this tool_call_id.', 'user_action')
  // 历史查询只复用原请求身份；不得恢复旧 grant、attachment 或执行代次。
  args.client_request_id = original.request_id
  delete args.tool_call_id
}
